from __future__ import annotations

import json
import wave
from pathlib import Path

import pytest

from stt_lab.training import (
    TrainingArtifactWriter,
    TrainingRunConfig,
    deterministic_batches,
    load_training_dataset,
    load_training_pair,
)


def _write_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(b"\0\0" * 16_000)


def _write_manifest(
    path: Path,
    *,
    split: str,
    speakers: tuple[str, ...],
    lecture_prefix: str,
) -> None:
    records = []
    for index, speaker_id in enumerate(speakers):
        audio_path = path.parent / f"{split}-{index}.wav"
        _write_wav(audio_path)
        records.append(
            {
                "id": f"{split}-{index}",
                "audioPath": str(audio_path),
                "reference": f"강의 음성 {index}",
                "trainingReference": f"written transcript {index}",
                "language": "ko-KR",
                "speakerId": speaker_id,
                "lectureId": f"{lecture_prefix}-{index}",
                "category": "engineering/computer",
                "durationMs": 1_000,
                "split": split,
                "terms": [],
                "consent": "AI-Hub-license",
            }
        )
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def test_training_pair_accepts_only_disjoint_train_and_dev(tmp_path: Path) -> None:
    train = tmp_path / "train.jsonl"
    dev = tmp_path / "dev.jsonl"
    _write_manifest(
        train,
        split="train",
        speakers=("speaker-1", "speaker-2", "speaker-3", "speaker-4"),
        lecture_prefix="train-lecture",
    )
    _write_manifest(
        dev,
        split="dev",
        speakers=("speaker-5", "speaker-6"),
        lecture_prefix="dev-lecture",
    )

    pair = load_training_pair(train, dev)

    assert len(pair.train.examples) == 4
    assert len(pair.dev.examples) == 2
    assert pair.train.manifest_sha256 != pair.dev.manifest_sha256
    assert all(example.lecture_id.startswith("train-lecture") for example in pair.train.examples)
    assert pair.train.examples[0].transcript.startswith("written transcript")


def test_training_manifest_fails_closed_for_test_split(tmp_path: Path) -> None:
    manifest = tmp_path / "test.jsonl"
    _write_manifest(
        manifest,
        split="test",
        speakers=("speaker-test",),
        lecture_prefix="test-lecture",
    )

    with pytest.raises(ValueError, match="forbidden splits"):
        load_training_dataset(manifest, expected_split="train")
    with pytest.raises(ValueError, match="train or dev"):
        load_training_dataset(manifest, expected_split="test")


def test_training_pair_rejects_speaker_and_lecture_leakage(tmp_path: Path) -> None:
    train = tmp_path / "train.jsonl"
    dev = tmp_path / "dev.jsonl"
    _write_manifest(
        train,
        split="train",
        speakers=("same-speaker",),
        lecture_prefix="train-lecture",
    )
    _write_manifest(
        dev,
        split="dev",
        speakers=("same-speaker",),
        lecture_prefix="dev-lecture",
    )

    with pytest.raises(ValueError, match="speaker leakage"):
        load_training_pair(train, dev)

    _write_manifest(
        dev,
        split="dev",
        speakers=("new-speaker",),
        lecture_prefix="train-lecture",
    )
    with pytest.raises(ValueError, match="lecture leakage"):
        load_training_pair(train, dev)


def test_training_batches_are_deterministic_and_do_not_vad_split(tmp_path: Path) -> None:
    manifest = tmp_path / "train.jsonl"
    _write_manifest(
        manifest,
        split="train",
        speakers=("s1", "s2", "s3", "s4", "s5"),
        lecture_prefix="lecture",
    )
    examples = load_training_dataset(manifest, expected_split="train").examples

    first = tuple(deterministic_batches(examples, batch_size=2, seed=7))
    second = tuple(deterministic_batches(examples, batch_size=2, seed=7))

    assert [[item.example_id for item in batch] for batch in first] == [
        [item.example_id for item in batch] for batch in second
    ]
    assert sum(len(batch) for batch in first) == len(examples)
    assert {item.audio_path for batch in first for item in batch} == {
        item.audio_path for item in examples
    }


def test_artifact_writer_records_reproducible_metadata_without_secrets(tmp_path: Path) -> None:
    train = tmp_path / "train.jsonl"
    dev = tmp_path / "dev.jsonl"
    _write_manifest(
        train,
        split="train",
        speakers=("train-speaker",),
        lecture_prefix="train-lecture",
    )
    _write_manifest(
        dev,
        split="dev",
        speakers=("dev-speaker",),
        lecture_prefix="dev-lecture",
    )
    pair = load_training_pair(train, dev)
    writer = TrainingArtifactWriter(tmp_path / "checkpoints", "dry-run-001")
    writer.initialize()
    writer.write_config(
        TrainingRunConfig(
            base_model="openai/whisper-large-v3",
            method="full",
            seed=7,
            precision="bfloat16",
            learning_rate=1e-5,
            batch_size=2,
            gradient_accumulation=1,
            max_audio_seconds=30,
            max_text_tokens=448,
        )
    )
    writer.write_dataset(pair)
    writer.append_metric({"step": 1, "trainLoss": 2.5})

    dataset = json.loads((writer.run_dir / "dataset.json").read_text(encoding="utf-8"))
    assert dataset["train"]["manifestSha256"] == pair.train.manifest_sha256
    assert "transcript" not in json.dumps(dataset)
    assert writer.checkpoint_dir.is_dir()
    assert writer.processor_dir.is_dir()
    with pytest.raises(ValueError, match="secret-like field"):
        writer.write_json("unsafe.json", {"apiToken": "must-not-be-written"})
    assert not (writer.run_dir / "unsafe.json").exists()
