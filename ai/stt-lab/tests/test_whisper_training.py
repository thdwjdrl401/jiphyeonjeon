from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from stt_lab.audio import PcmAudio
from stt_lab.training import (
    TrainingArtifactWriter,
    TrainingDataset,
    TrainingDatasetPair,
    TrainingExample,
)
from stt_lab.whisper_training import (
    TransformersWhisperBackend,
    WhisperDryRunRequest,
    run_whisper_dry_run,
    validate_whisper_dry_run_request,
)


def _example(index: int, split: str) -> TrainingExample:
    return TrainingExample(
        example_id=f"{split}-{index}",
        audio_path=Path(f"/{split}-{index}.wav"),
        transcript=f"강의 음성 {index}",
        language="ko-KR",
        speaker_id=f"{split}-speaker-{index}",
        lecture_id=f"{split}-lecture-{index}",
        split=split,
        duration_ms=1_000,
        consent="AI-Hub-license",
        audio_sha256=None,
    )


def _datasets(*, train_count: int = 4, dev_count: int = 2) -> TrainingDatasetPair:
    return TrainingDatasetPair(
        train=TrainingDataset(
            manifest_path=Path("/train.jsonl"),
            manifest_sha256="a" * 64,
            split="train",
            examples=tuple(_example(index, "train") for index in range(train_count)),
        ),
        dev=TrainingDataset(
            manifest_path=Path("/dev.jsonl"),
            manifest_sha256="b" * 64,
            split="dev",
            examples=tuple(_example(index, "dev") for index in range(dev_count)),
        ),
    )


def _request() -> WhisperDryRunRequest:
    return WhisperDryRunRequest(
        model_id="openai/whisper-large-v3",
        device="cuda:0",
        precision="bfloat16",
        batch_size=2,
        learning_rate=1e-5,
        seed=7,
        max_audio_seconds=30,
        max_text_tokens=448,
    )


class FakeBackend:
    def __init__(self, request, writer) -> None:
        self.request = request
        self.writer = writer
        self.loaded = False
        self.closed = False
        self.train_ids: list[str] = []

    def load(self) -> None:
        self.loaded = True

    def train_step(self, examples) -> float:
        assert self.loaded
        self.train_ids = [example.example_id for example in examples]
        return 1.25

    def eval_step(self, examples) -> float:
        assert len(examples) == 2
        return 0.75

    def save(self, writer: TrainingArtifactWriter) -> None:
        (writer.checkpoint_dir / "model.safetensors").write_bytes(b"fixture")
        (writer.processor_dir / "processor.json").write_text("{}", encoding="utf-8")
        (writer.run_dir / "optimizer-state.pt").write_bytes(b"fixture")

    def close(self) -> None:
        self.closed = True


def test_dry_run_executes_initial_dev_and_distinct_resume_batch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "0")
    created: list[FakeBackend] = []
    resumed_ids: list[str] = []

    def factory(request, writer) -> FakeBackend:
        backend = FakeBackend(request, writer)
        created.append(backend)
        return backend

    def resume(examples) -> float:
        resumed_ids.extend(example.example_id for example in examples)
        return 1.0

    writer = TrainingArtifactWriter(tmp_path, "whisper-dry-run")
    result = run_whisper_dry_run(
        _datasets(),
        _request(),
        writer,
        backend_factory=factory,
        resume_runner=resume,
    )

    assert result.first_train_loss == 1.25
    assert result.dev_loss == 0.75
    assert result.resumed_train_loss == 1.0
    assert set(created[0].train_ids).isdisjoint(resumed_ids)
    assert created[0].loaded and created[0].closed
    state = json.loads((writer.run_dir / "trainer-state.json").read_text(encoding="utf-8"))
    assert state["status"] == "RESUME_VERIFIED"
    assert state["completedSteps"] == 2
    assert len((writer.run_dir / "metrics.jsonl").read_text().splitlines()) == 3


def test_dry_run_requires_two_train_batches_before_creating_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "0")
    writer = TrainingArtifactWriter(tmp_path, "insufficient")

    with pytest.raises(ValueError, match="two complete train batches"):
        run_whisper_dry_run(
            _datasets(train_count=3),
            _request(),
            writer,
            backend_factory=FakeBackend,
            resume_runner=lambda examples: 1.0,
        )

    assert not writer.run_dir.exists()


def test_whisper_dry_run_is_restricted_to_gpu_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "1")
    with pytest.raises(ValueError, match="CUDA_VISIBLE_DEVICES=0"):
        validate_whisper_dry_run_request(_request())

    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "0")
    invalid = WhisperDryRunRequest(**{**_request().__dict__, "device": "cuda:1"})
    with pytest.raises(ValueError, match="cuda:0"):
        validate_whisper_dry_run_request(invalid)


def test_training_batch_pads_audio_to_whisper_max_length(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import torch

    captured: dict[str, object] = {}

    class FakeProcessor:
        def feature_extractor(self, audio_values, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                input_features=torch.zeros((len(audio_values), 80, 3000)),
                attention_mask=torch.ones((len(audio_values), 3000), dtype=torch.long),
            )

        def tokenizer(self, transcripts, **kwargs):
            del kwargs
            return SimpleNamespace(
                input_ids=torch.ones((len(transcripts), 8), dtype=torch.long),
                attention_mask=torch.ones((len(transcripts), 8), dtype=torch.long),
            )

    monkeypatch.setattr(
        "stt_lab.whisper_training.read_pcm16_mono_wav",
        lambda *args, **kwargs: PcmAudio(
            samples=np.zeros(16_000, dtype=np.int16),
            sample_rate=16_000,
            duration_ms=1_000,
            sha256="a" * 64,
        ),
    )
    request = WhisperDryRunRequest(
        **{
            **_request().__dict__,
            "device": "cpu",
            "precision": "float32",
        }
    )
    backend = TransformersWhisperBackend(
        request,
        TrainingArtifactWriter(tmp_path, "padding-test"),
    )
    backend._processor = FakeProcessor()
    backend._model = SimpleNamespace(dtype=torch.float32)

    batch = backend._batch((_example(0, "train"), _example(1, "train")))

    assert captured["padding"] == "max_length"
    assert captured["return_attention_mask"] is True
    assert batch["input_features"].shape == (2, 80, 3000)


def test_save_makes_checkpoint_self_contained_with_processor(tmp_path: Path) -> None:
    writer = TrainingArtifactWriter(tmp_path, "self-contained")
    writer.initialize()
    processor_paths: list[Path] = []

    class FakeModel:
        def save_pretrained(self, path, **kwargs) -> None:
            assert kwargs["safe_serialization"] is True
            (Path(path) / "model.safetensors").write_bytes(b"model")

    class FakeProcessor:
        def save_pretrained(self, path) -> None:
            target = Path(path)
            processor_paths.append(target)
            (target / "preprocessor_config.json").write_text("{}", encoding="utf-8")

    class FakeTorch:
        @staticmethod
        def save(state, path) -> None:
            del state
            Path(path).write_bytes(b"optimizer")

    backend = TransformersWhisperBackend(_request(), writer)
    backend._torch = FakeTorch()
    backend._model = FakeModel()
    backend._processor = FakeProcessor()
    backend._optimizer = SimpleNamespace(state_dict=lambda: {"step": 1})

    backend.save(writer)

    assert processor_paths == [writer.processor_dir, writer.checkpoint_dir]
    assert (writer.checkpoint_dir / "model.safetensors").is_file()
    assert (writer.checkpoint_dir / "preprocessor_config.json").is_file()
    assert (writer.processor_dir / "preprocessor_config.json").is_file()
    assert (writer.run_dir / "optimizer-state.pt").is_file()
