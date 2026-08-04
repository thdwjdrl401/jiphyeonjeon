from __future__ import annotations

import gc
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Protocol

from stt_lab.audio import PcmAudio


@dataclass(frozen=True)
class Transcription:
    text: str
    first_delta_ms: float
    total_ms: float


class Transcriber(Protocol):
    @property
    def model_id(self) -> str: ...

    @property
    def precision(self) -> str: ...

    def load(self) -> None: ...

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription: ...

    def close(self) -> None: ...


class NemotronRuntimeRunner:
    """Benchmark the exact Nemotron adapter used by realtime-agent."""

    def __init__(self, model_id: str) -> None:
        self._model_id = model_id
        self._recognizer = None

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def precision(self) -> str:
        return "runtime-default"

    def load(self) -> None:
        from app.stt.nemotron_asr import NemotronStreamingASR

        self._recognizer = NemotronStreamingASR(self._model_id, "ko-KR")
        self._recognizer.load()

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription:
        if self._recognizer is None:
            raise RuntimeError("Nemotron runner is not loaded")
        if language != "ko-KR":
            raise ValueError("the current Nemotron runtime benchmark expects ko-KR")
        started = perf_counter()
        first_delta_ms: float | None = None
        chunks: list[str] = []
        for chunk in self._recognizer.transcribe_stream(audio.samples, audio.sample_rate):
            if first_delta_ms is None and chunk:
                first_delta_ms = (perf_counter() - started) * 1_000
            chunks.append(chunk)
        total_ms = (perf_counter() - started) * 1_000
        return Transcription(
            text="".join(chunks).strip(),
            first_delta_ms=first_delta_ms if first_delta_ms is not None else total_ms,
            total_ms=total_ms,
        )

    def close(self) -> None:
        if self._recognizer is not None:
            self._recognizer.close()
            self._recognizer = None


class NemotronNemoRunner:
    """Run a Prompt-RNNT ``.nemo`` checkpoint for checkpoint quality gates.

    This deliberately uses offline final-only decoding. Base and fine-tuned
    checkpoints pass through this exact runner so their accuracy comparison is
    not confounded by the Hugging Face streaming adapter.
    """

    def __init__(self, model_id: str, *, device: str) -> None:
        self._model_id = model_id
        self._device = device
        self._model = None

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def precision(self) -> str:
        # Cache-aware Nemotron inference is validated in FP32. Keeping the
        # quality gate in FP32 also avoids precision drift between checkpoints.
        return "float32"

    def load(self) -> None:
        model_path = Path(self._model_id)
        if not model_path.is_file() or model_path.suffix != ".nemo":
            raise ValueError(f"Nemotron NeMo checkpoint does not exist: {model_path}")
        try:
            import torch
            from nemo.collections.asr.models import ASRModel
        except ImportError as exc:
            raise RuntimeError(
                "NeMo dependencies are missing; use the pinned Nemotron training runtime"
            ) from exc

        model = ASRModel.restore_from(
            restore_path=str(model_path),
            map_location="cpu",
        )
        if not hasattr(model, "set_inference_prompt"):
            raise TypeError("checkpoint is not a Prompt-RNNT model")
        model.set_inference_prompt("ko-KR")
        if hasattr(model, "decoding") and hasattr(model.decoding, "set_strip_lang_tags"):
            model.decoding.set_strip_lang_tags(True)
        model.to(device=self._device, dtype=torch.float32)
        model.eval()
        self._model = model

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription:
        if self._model is None:
            raise RuntimeError("Nemotron NeMo runner is not loaded")
        if language != "ko-KR":
            raise ValueError("the current Nemotron NeMo benchmark expects ko-KR")
        if audio.sample_rate != 16_000:
            raise ValueError("the current Nemotron NeMo benchmark expects 16 kHz audio")

        import torch

        float_audio = audio.samples.astype("float32") / 32768.0
        if self._device.startswith("cuda"):
            torch.cuda.synchronize()
        started = perf_counter()
        with torch.inference_mode():
            results = self._model.transcribe(
                audio=float_audio,
                batch_size=1,
                num_workers=0,
                verbose=False,
                target_lang=language,
            )
        if self._device.startswith("cuda"):
            torch.cuda.synchronize()
        total_ms = (perf_counter() - started) * 1_000
        result = results[0]
        text = result.text if hasattr(result, "text") else str(result)
        return Transcription(text=text.strip(), first_delta_ms=total_ms, total_ms=total_ms)

    def close(self) -> None:
        self._model = None
        gc.collect()
        try:
            import torch
        except ImportError:
            return
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


class WhisperTransformersRunner:
    """Run an open-weight Whisper checkpoint through Transformers."""

    def __init__(self, model_id: str, *, device: str, precision: str) -> None:
        self._model_id = model_id
        self._device = device
        self._precision = precision
        self._processor = None
        self._model = None

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def precision(self) -> str:
        return self._precision

    def load(self) -> None:
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

        dtype = {
            "bfloat16": torch.bfloat16,
            "float16": torch.float16,
            "float32": torch.float32,
        }[self._precision]
        self._processor = AutoProcessor.from_pretrained(self._model_id)
        self._model = AutoModelForSpeechSeq2Seq.from_pretrained(
            self._model_id,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        ).to(self._device)
        self._model.eval()

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription:
        if self._processor is None or self._model is None:
            raise RuntimeError("Whisper runner is not loaded")
        import torch

        float_audio = audio.samples.astype("float32") / 32768.0
        inputs = self._processor(
            float_audio,
            sampling_rate=audio.sample_rate,
            return_tensors="pt",
        )
        input_features = inputs.input_features.to(
            self._device,
            dtype=self._model.dtype,
        )
        attention_mask = getattr(inputs, "attention_mask", None)
        if attention_mask is not None:
            attention_mask = attention_mask.to(self._device)
        started = perf_counter()
        with torch.inference_mode():
            generated = self._model.generate(
                input_features=input_features,
                attention_mask=attention_mask,
                language=language.split("-", 1)[0],
                task="transcribe",
            )
        if self._device.startswith("cuda"):
            torch.cuda.synchronize()
        total_ms = (perf_counter() - started) * 1_000
        text = self._processor.batch_decode(generated, skip_special_tokens=True)[0].strip()
        # Whisper produces one final result in this harness. It is not a native
        # realtime delta, so first-delta equals completion latency by definition.
        return Transcription(text=text, first_delta_ms=total_ms, total_ms=total_ms)

    def close(self) -> None:
        self._processor = None
        self._model = None


def build_runner(
    backend: str,
    model_id: str,
    *,
    device: str,
    precision: str,
) -> Transcriber:
    if backend == "nemotron":
        return NemotronRuntimeRunner(model_id)
    if backend == "nemotron-nemo":
        return NemotronNemoRunner(model_id, device=device)
    if backend == "whisper":
        return WhisperTransformersRunner(
            model_id,
            device=device,
            precision=precision,
        )
    raise ValueError(f"unsupported backend: {backend}")
