from __future__ import annotations

import gc
import math
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from stt_lab.audio import read_pcm16_mono_wav
from stt_lab.training import (
    TrainingArtifactWriter,
    TrainingDatasetPair,
    TrainingExample,
    TrainingRunConfig,
    deterministic_batches,
)


@dataclass(frozen=True)
class WhisperDryRunRequest:
    model_id: str
    device: str
    precision: str
    batch_size: int
    learning_rate: float
    seed: int
    max_audio_seconds: float
    max_text_tokens: int


@dataclass(frozen=True)
class WhisperDryRunResult:
    first_train_loss: float
    dev_loss: float
    resumed_train_loss: float


class WhisperTrainingBackend(Protocol):
    def load(self) -> None: ...

    def train_step(self, examples: Sequence[TrainingExample]) -> float: ...

    def eval_step(self, examples: Sequence[TrainingExample]) -> float: ...

    def save(self, writer: TrainingArtifactWriter) -> None: ...

    def close(self) -> None: ...


BackendFactory = Callable[
    [WhisperDryRunRequest, TrainingArtifactWriter],
    WhisperTrainingBackend,
]
ResumeRunner = Callable[[tuple[TrainingExample, ...]], float]


def run_whisper_dry_run(
    datasets: TrainingDatasetPair,
    request: WhisperDryRunRequest,
    writer: TrainingArtifactWriter,
    *,
    backend_factory: BackendFactory | None = None,
    resume_runner: ResumeRunner,
) -> WhisperDryRunResult:
    validate_whisper_dry_run_request(request)
    train_batches = tuple(
        deterministic_batches(
            datasets.train.examples,
            batch_size=request.batch_size,
            seed=request.seed,
        )
    )
    dev_batches = tuple(
        deterministic_batches(
            datasets.dev.examples,
            batch_size=request.batch_size,
            seed=request.seed,
        )
    )
    if len(train_batches) < 2 or any(
        len(batch) != request.batch_size for batch in train_batches[:2]
    ):
        raise ValueError("Whisper dry-run requires at least two complete train batches")
    if not dev_batches or len(dev_batches[0]) != request.batch_size:
        raise ValueError("Whisper dry-run requires at least one complete dev batch")

    writer.initialize()
    writer.write_config(
        TrainingRunConfig(
            base_model=request.model_id,
            method="full",
            seed=request.seed,
            precision=request.precision,
            learning_rate=request.learning_rate,
            batch_size=request.batch_size,
            gradient_accumulation=1,
            max_audio_seconds=request.max_audio_seconds,
            max_text_tokens=request.max_text_tokens,
        )
    )
    writer.write_dataset(datasets)

    factory = backend_factory or TransformersWhisperBackend
    backend = factory(request, writer)
    try:
        backend.load()
        first_train_loss = backend.train_step(train_batches[0])
        dev_loss = backend.eval_step(dev_batches[0])
        backend.save(writer)
    finally:
        backend.close()

    writer.append_metric({"phase": "initial", "step": 1, "trainLoss": first_train_loss})
    writer.append_metric({"phase": "dev", "step": 1, "devLoss": dev_loss})
    resumed_train_loss = resume_runner(train_batches[1])
    writer.append_metric({"phase": "resume", "step": 2, "trainLoss": resumed_train_loss})
    writer.write_trainer_state(
        {
            "status": "RESUME_VERIFIED",
            "completedSteps": 2,
            "initialTrainLoss": first_train_loss,
            "devLoss": dev_loss,
            "resumedTrainLoss": resumed_train_loss,
        }
    )
    return WhisperDryRunResult(first_train_loss, dev_loss, resumed_train_loss)


def validate_whisper_dry_run_request(request: WhisperDryRunRequest) -> None:
    if os.environ.get("CUDA_VISIBLE_DEVICES") != "0":
        raise ValueError("Whisper training dry-run requires CUDA_VISIBLE_DEVICES=0")
    if request.device != "cuda:0":
        raise ValueError("Whisper training dry-run is restricted to cuda:0")
    if request.precision not in {"bfloat16", "float16", "float32"}:
        raise ValueError("unsupported Whisper training precision")
    if request.batch_size <= 0:
        raise ValueError("batch_size must be positive")
    if request.learning_rate <= 0:
        raise ValueError("learning_rate must be positive")
    if request.max_audio_seconds <= 0 or request.max_text_tokens <= 0:
        raise ValueError("audio and text limits must be positive")


class TransformersWhisperBackend:
    def __init__(
        self,
        request: WhisperDryRunRequest,
        writer: TrainingArtifactWriter,
        *,
        model_source: str | Path | None = None,
        processor_source: str | Path | None = None,
        optimizer_state: Path | None = None,
    ) -> None:
        self._request = request
        self._writer = writer
        self._model_source = str(model_source or request.model_id)
        self._processor_source = str(processor_source or request.model_id)
        self._optimizer_state = optimizer_state
        self._torch: Any = None
        self._processor: Any = None
        self._model: Any = None
        self._optimizer: Any = None

    def load(self) -> None:
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

        torch.manual_seed(self._request.seed)
        dtype = {
            "bfloat16": torch.bfloat16,
            "float16": torch.float16,
            "float32": torch.float32,
        }[self._request.precision]
        self._processor = AutoProcessor.from_pretrained(
            self._processor_source,
            language="ko",
            task="transcribe",
        )
        self._model = AutoModelForSpeechSeq2Seq.from_pretrained(
            self._model_source,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        ).to(self._request.device)
        self._model.config.use_cache = False
        self._model.gradient_checkpointing_enable()
        self._optimizer = torch.optim.AdamW(
            self._model.parameters(),
            lr=self._request.learning_rate,
        )
        if self._optimizer_state is not None:
            state = torch.load(
                self._optimizer_state,
                map_location=self._request.device,
                weights_only=True,
            )
            self._optimizer.load_state_dict(state)
        self._torch = torch

    def train_step(self, examples: Sequence[TrainingExample]) -> float:
        self._require_loaded()
        self._model.train()
        self._optimizer.zero_grad(set_to_none=True)
        loss = self._model(**self._batch(examples)).loss
        if not bool(self._torch.isfinite(loss)):
            raise RuntimeError("Whisper training loss is not finite")
        loss.backward()
        self._optimizer.step()
        self._torch.cuda.synchronize()
        return float(loss.detach().float().cpu())

    def eval_step(self, examples: Sequence[TrainingExample]) -> float:
        self._require_loaded()
        self._model.eval()
        with self._torch.inference_mode():
            loss = self._model(**self._batch(examples)).loss
        self._torch.cuda.synchronize()
        value = float(loss.detach().float().cpu())
        if not math.isfinite(value):
            raise RuntimeError("Whisper dev loss is not finite")
        return value

    def save(self, writer: TrainingArtifactWriter) -> None:
        self._require_loaded()
        self._model.save_pretrained(writer.checkpoint_dir, safe_serialization=True)
        self._processor.save_pretrained(writer.processor_dir)
        self._processor.save_pretrained(writer.checkpoint_dir)
        self._torch.save(
            self._optimizer.state_dict(),
            writer.run_dir / "optimizer-state.pt",
        )

    def close(self) -> None:
        self._optimizer = None
        self._model = None
        self._processor = None
        if self._torch is not None:
            gc.collect()
            self._torch.cuda.empty_cache()
        self._torch = None

    def _batch(self, examples: Sequence[TrainingExample]) -> dict[str, Any]:
        audio_values = []
        transcripts = []
        for example in examples:
            audio = read_pcm16_mono_wav(
                example.audio_path,
                expected_sha256=example.audio_sha256,
            )
            if audio.duration_ms > self._request.max_audio_seconds * 1_000:
                raise ValueError(f"training clip exceeds max_audio_seconds: {example.example_id}")
            audio_values.append(audio.samples.astype("float32") / 32768.0)
            transcripts.append(example.transcript)

        features = self._processor.feature_extractor(
            audio_values,
            sampling_rate=16_000,
            return_tensors="pt",
            padding="max_length",
            return_attention_mask=True,
        )
        tokens = self._processor.tokenizer(
            transcripts,
            return_tensors="pt",
            padding=True,
            add_special_tokens=True,
        )
        if tokens.input_ids.shape[1] > self._request.max_text_tokens:
            raise ValueError("training transcript exceeds max_text_tokens")
        labels = tokens.input_ids.masked_fill(tokens.attention_mask.ne(1), -100)
        batch = {
            "input_features": features.input_features.to(
                self._request.device,
                dtype=self._model.dtype,
            ),
            "labels": labels.to(self._request.device),
        }
        if hasattr(features, "attention_mask"):
            batch["attention_mask"] = features.attention_mask.to(self._request.device)
        return batch

    def _require_loaded(self) -> None:
        if self._torch is None or self._processor is None or self._model is None:
            raise RuntimeError("Whisper training backend is not loaded")


def resume_transformers_whisper(
    request: WhisperDryRunRequest,
    writer: TrainingArtifactWriter,
    examples: Sequence[TrainingExample],
) -> float:
    backend = TransformersWhisperBackend(
        request,
        writer,
        model_source=writer.checkpoint_dir,
        processor_source=writer.processor_dir,
        optimizer_state=writer.run_dir / "optimizer-state.pt",
    )
    try:
        backend.load()
        loss = backend.train_step(examples)
        backend.save(writer)
        return loss
    finally:
        backend.close()
