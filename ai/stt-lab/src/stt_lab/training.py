from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from pathlib import Path
from typing import Any

from stt_lab.contracts import EvaluationClip, load_manifest
from stt_lab.transcriptions import canonical_transcription

_SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SECRET_KEYS = frozenset({"secret", "password", "token", "api_key", "apikey"})
_SECRET_KEY_SUFFIXES = ("_secret", "_password", "_token", "_api_key")


@dataclass(frozen=True)
class TrainingExample:
    example_id: str
    audio_path: Path
    transcript: str
    language: str
    speaker_id: str
    lecture_id: str
    split: str
    duration_ms: int
    consent: str
    audio_sha256: str | None


@dataclass(frozen=True)
class TrainingDataset:
    manifest_path: Path
    manifest_sha256: str
    split: str
    examples: tuple[TrainingExample, ...]


@dataclass(frozen=True)
class TrainingDatasetPair:
    train: TrainingDataset
    dev: TrainingDataset


@dataclass(frozen=True)
class TrainingRunConfig:
    base_model: str
    method: str
    seed: int
    precision: str
    learning_rate: float
    batch_size: int
    gradient_accumulation: int
    max_audio_seconds: float
    max_text_tokens: int


class TrainingArtifactWriter:
    def __init__(self, root: Path, run_id: str) -> None:
        if not _SAFE_RUN_ID.fullmatch(run_id):
            raise ValueError("run_id must be a safe non-blank identifier")
        self.run_dir = (root / run_id).resolve()
        self.checkpoint_dir = self.run_dir / "checkpoint"
        self.processor_dir = self.run_dir / "processor"

    def initialize(self) -> None:
        self.checkpoint_dir.mkdir(parents=True, exist_ok=False)
        self.processor_dir.mkdir(parents=True, exist_ok=False)

    def write_config(self, config: TrainingRunConfig) -> Path:
        return self.write_json("config.json", config)

    def write_dataset(self, datasets: TrainingDatasetPair) -> Path:
        return self.write_json(
            "dataset.json",
            {
                "train": _dataset_summary(datasets.train),
                "dev": _dataset_summary(datasets.dev),
            },
        )

    def write_trainer_state(self, value: Mapping[str, Any]) -> Path:
        return self.write_json("trainer-state.json", value)

    def append_metric(self, value: Mapping[str, Any]) -> Path:
        _reject_secret_keys(value)
        path = self.run_dir / "metrics.jsonl"
        with path.open("a", encoding="utf-8") as target:
            target.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")
        return path

    def write_json(self, relative_path: str, value: Any) -> Path:
        serializable = asdict(value) if is_dataclass(value) else value
        _reject_secret_keys(serializable)
        path = self.run_dir / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(serializable, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return path


def load_training_dataset(path: Path, *, expected_split: str) -> TrainingDataset:
    if expected_split not in {"train", "dev"}:
        raise ValueError("training datasets may only use train or dev")
    clips = load_manifest(path)
    invalid_splits = sorted({clip.split for clip in clips if clip.split != expected_split})
    if invalid_splits:
        raise ValueError(f"{expected_split} manifest contains forbidden splits: {invalid_splits}")
    examples = tuple(_training_example(clip) for clip in clips)
    return TrainingDataset(
        manifest_path=path.resolve(),
        manifest_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        split=expected_split,
        examples=examples,
    )


def load_training_pair(train_manifest: Path, dev_manifest: Path) -> TrainingDatasetPair:
    pair = TrainingDatasetPair(
        train=load_training_dataset(train_manifest, expected_split="train"),
        dev=load_training_dataset(dev_manifest, expected_split="dev"),
    )
    _validate_disjoint(pair)
    return pair


def deterministic_batches(
    examples: Sequence[TrainingExample],
    *,
    batch_size: int,
    seed: int,
) -> Iterator[tuple[TrainingExample, ...]]:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    ordered = sorted(
        examples,
        key=lambda example: hashlib.sha256(f"{seed}:{example.example_id}".encode()).hexdigest(),
    )
    for offset in range(0, len(ordered), batch_size):
        yield tuple(ordered[offset : offset + batch_size])


def dataset_pair_summary(pair: TrainingDatasetPair) -> dict[str, Any]:
    return {
        "train": _dataset_summary(pair.train),
        "dev": _dataset_summary(pair.dev),
        "speakerIntersection": 0,
        "lectureIntersection": 0,
    }


def _training_example(clip: EvaluationClip) -> TrainingExample:
    if clip.lecture_id is None:
        raise ValueError(f"training clip {clip.clip_id} is missing lectureId")
    if clip.duration_ms is None:
        raise ValueError(f"training clip {clip.clip_id} is missing durationMs")
    return TrainingExample(
        example_id=clip.clip_id,
        audio_path=clip.audio_path,
        transcript=clip.training_reference or canonical_transcription(clip.reference),
        language=clip.language,
        speaker_id=clip.speaker_id,
        lecture_id=clip.lecture_id,
        split=clip.split,
        duration_ms=clip.duration_ms,
        consent=clip.consent,
        audio_sha256=clip.sha256,
    )


def _validate_disjoint(pair: TrainingDatasetPair) -> None:
    train_ids = {example.example_id for example in pair.train.examples}
    dev_ids = {example.example_id for example in pair.dev.examples}
    if overlap := train_ids & dev_ids:
        raise ValueError(f"train/dev clip leakage: {sorted(overlap)[:10]}")

    train_speakers = {example.speaker_id for example in pair.train.examples}
    dev_speakers = {example.speaker_id for example in pair.dev.examples}
    if overlap := train_speakers & dev_speakers:
        raise ValueError(f"train/dev speaker leakage: {sorted(overlap)[:10]}")

    train_lectures = {example.lecture_id for example in pair.train.examples}
    dev_lectures = {example.lecture_id for example in pair.dev.examples}
    if overlap := train_lectures & dev_lectures:
        raise ValueError(f"train/dev lecture leakage: {sorted(overlap)[:10]}")


def _dataset_summary(dataset: TrainingDataset) -> dict[str, Any]:
    return {
        "manifest": str(dataset.manifest_path),
        "manifestSha256": dataset.manifest_sha256,
        "split": dataset.split,
        "clipCount": len(dataset.examples),
        "durationMs": sum(example.duration_ms for example in dataset.examples),
        "speakerCount": len({example.speaker_id for example in dataset.examples}),
        "lectureCount": len({example.lecture_id for example in dataset.examples}),
        "consentValues": sorted({example.consent for example in dataset.examples}),
    }


def _reject_secret_keys(value: Any, *, path: str = "root") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).lower().replace("-", "_")
            compact = normalized.replace("_", "")
            if (
                normalized in _SECRET_KEYS
                or normalized.endswith(_SECRET_KEY_SUFFIXES)
                or compact in {"apitoken", "accesstoken", "refreshtoken", "bearertoken"}
            ):
                raise ValueError(f"secret-like field is forbidden in artifacts: {path}.{key}")
            _reject_secret_keys(child, path=f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _reject_secret_keys(child, path=f"{path}[{index}]")
