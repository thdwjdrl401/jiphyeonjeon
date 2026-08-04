from __future__ import annotations

import json
import wave
from pathlib import Path

import pytest

from stt_lab.contracts import EvaluationClip
from stt_lab.training import _require_empty_output, main, select_training_clips


def _clip(
    clip_id: str,
    *,
    speaker: str,
    lecture: str,
    category: str,
    duration_ms: int,
    training_reference: str = "software를 사용합니다.",
) -> EvaluationClip:
    return EvaluationClip(
        clip_id=clip_id,
        audio_path=Path(f"/{clip_id}.wav"),
        reference="(software)/(소프트웨어)를 사용합니다.",
        training_reference=training_reference,
        lecture_id=lecture,
        category=category,
        duration_ms=duration_ms,
        language="ko-KR",
        speaker_id=speaker,
        split="train",
        terms=(),
        consent="AI-Hub-license",
    )


def test_training_selection_is_deterministic_diverse_and_excludes_long_audio() -> None:
    clips = (
        _clip("a1", speaker="s1", lecture="l1", category="eng/arch", duration_ms=1_000),
        _clip("a2", speaker="s1", lecture="l1", category="eng/arch", duration_ms=1_000),
        _clip("b1", speaker="s2", lecture="l2", category="eng/comp", duration_ms=1_000),
        _clip("c1", speaker="s3", lecture="l3", category="eng/elec", duration_ms=31_000),
        _clip(
            "d1",
            speaker="s4",
            lecture="l4",
            category="eng/elec",
            duration_ms=1_000,
            training_reference="(precut)/(프리컷이 잘립니다.",
        ),
    )

    first = select_training_clips(
        clips,
        max_audio_hours=2_000 / 3_600_000,
        max_clips=None,
        max_duration_ms=30_000,
        seed=7,
    )
    second = select_training_clips(
        clips,
        max_audio_hours=2_000 / 3_600_000,
        max_clips=None,
        max_duration_ms=30_000,
        seed=7,
    )

    assert [clip.clip_id for clip in first.clips] == [clip.clip_id for clip in second.clips]
    assert {clip.speaker_id for clip in first.clips} == {"s1", "s2"}
    assert first.duration_ms == 2_000
    assert first.excluded_too_long == 1

    assert first.excluded_invalid_reference == 1


def test_dry_run_uses_refined_manifest_without_loading_model(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    audio_path = tmp_path / "clip.wav"
    with wave.open(str(audio_path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(b"\x00\x00" * 16_000)
    manifest = tmp_path / "train.jsonl"
    manifest.write_text(
        json.dumps(
            {
                "id": "clip-1",
                "audioPath": str(audio_path),
                "reference": "(software)/(소프트웨어)를 사용합니다.",
                "trainingReference": "software를 사용합니다.",
                "language": "ko-KR",
                "speakerId": "speaker-1",
                "lectureId": "lecture-1",
                "category": "eng/comp",
                "durationMs": 1_000,
                "split": "train",
                "terms": [],
                "consent": "AI-Hub-license",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    exit_code = main(
        (
            "--base-model",
            "/model",
            "--train-manifest",
            str(manifest),
            "--output-dir",
            str(tmp_path / "output"),
            "--dry-run",
        )
    )

    report = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert report["selectedClips"] == 1
    assert report["selectedSpeakers"] == 1


def test_training_refuses_to_overwrite_artifacts(tmp_path: Path) -> None:
    output = tmp_path / "adapter"
    output.mkdir()
    (output / "adapter_model.safetensors").write_bytes(b"existing")

    with pytest.raises(ValueError, match="absent or empty"):
        _require_empty_output(output)
