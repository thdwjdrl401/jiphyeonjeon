from __future__ import annotations

import json
import wave
from pathlib import Path

import pytest

from stt_lab.qwen_training import export_qwen_training_data, qwen_target


def _write_wav(path: Path, value: int) -> None:
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(value.to_bytes(2, "little", signed=True) * 16_000)


def _record(
    root: Path,
    clip_id: str,
    *,
    split: str,
    speaker: str,
    lecture: str,
    value: int,
) -> dict[str, object]:
    audio = root / f"{clip_id}.wav"
    _write_wav(audio, value)
    return {
        "id": clip_id,
        "audioPath": str(audio),
        "reference": f"발음 전사 {clip_id}",
        "trainingReference": f"철자 전사 {clip_id}",
        "language": "ko-KR",
        "speakerId": speaker,
        "lectureId": lecture,
        "category": "engineering/computer",
        "durationMs": 1_000,
        "split": split,
        "terms": [],
        "consent": "AI-Hub-license",
    }


def _write_manifest(path: Path, records: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def test_qwen_target_uses_korean_prefix_without_exported_eos() -> None:
    target = qwen_target("  한국어 강의입니다.  ", "ko-KR")

    assert target == "language Korean<asr_text>한국어 강의입니다."
    assert "<|endoftext|>" not in target
    with pytest.raises(ValueError, match="already contains"):
        qwen_target(target, "ko-KR")


def test_export_partitions_train_components_and_protects_benchmark(tmp_path: Path) -> None:
    source = tmp_path / "train.jsonl"
    protected = tmp_path / "dev-benchmark.jsonl"
    records = [
        _record(tmp_path, "a-1", split="train", speaker="s-a", lecture="l-a", value=1),
        _record(tmp_path, "a-2", split="train", speaker="s-a", lecture="l-b", value=2),
        _record(tmp_path, "b-1", split="train", speaker="s-b", lecture="l-c", value=3),
        _record(tmp_path, "b-2", split="train", speaker="s-b", lecture="l-c", value=4),
        _record(tmp_path, "c-1", split="train", speaker="s-c", lecture="l-d", value=5),
    ]
    protected_records = [
        _record(
            tmp_path,
            "benchmark-1",
            split="dev",
            speaker="s-dev",
            lecture="l-dev",
            value=6,
        )
    ]
    _write_manifest(source, records)
    _write_manifest(protected, protected_records)

    result = export_qwen_training_data(
        source,
        [protected],
        tmp_path / "qwen",
        eval_ratio=0.4,
        verify_audio_content=True,
    )

    train_rows = [json.loads(line) for line in result.train_file.read_text().splitlines()]
    eval_rows = [json.loads(line) for line in result.eval_file.read_text().splitlines()]
    assert result.train_count + result.eval_count == len(records)
    assert {row["audio"] for row in train_rows}.isdisjoint({row["audio"] for row in eval_rows})
    assert all(set(row) == {"audio", "text"} for row in train_rows + eval_rows)
    assert all(
        row["text"].startswith("language Korean<asr_text>") for row in train_rows + eval_rows
    )
    provenance = json.loads(result.provenance_file.read_text())
    assert provenance["targetContainsEos"] is False
    assert provenance["audioContentVerified"] is True
    assert provenance["protectedIntersections"]["clipId"] == 0


def test_export_rejects_protected_speaker_or_audio_content_leakage(tmp_path: Path) -> None:
    source = tmp_path / "train.jsonl"
    protected = tmp_path / "protected.jsonl"
    source_records = [
        _record(tmp_path, "train-a", split="train", speaker="s-a", lecture="l-a", value=11),
        _record(tmp_path, "train-b", split="train", speaker="s-b", lecture="l-b", value=12),
    ]
    _write_manifest(source, source_records)
    speaker_leak = _record(
        tmp_path,
        "dev-a",
        split="dev",
        speaker="s-a",
        lecture="l-dev",
        value=13,
    )
    _write_manifest(protected, [speaker_leak])

    with pytest.raises(ValueError, match="speaker leakage"):
        export_qwen_training_data(source, [protected], tmp_path / "speaker-leak")

    audio_leak = _record(
        tmp_path,
        "dev-b",
        split="dev",
        speaker="s-dev",
        lecture="l-dev",
        value=11,
    )
    _write_manifest(protected, [audio_leak])
    with pytest.raises(ValueError, match="audio content leakage"):
        export_qwen_training_data(
            source,
            [protected],
            tmp_path / "audio-leak",
            verify_audio_content=True,
        )
