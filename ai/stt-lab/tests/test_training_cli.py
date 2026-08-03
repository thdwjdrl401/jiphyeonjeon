from __future__ import annotations

import json
import wave
from pathlib import Path

from stt_lab.training_cli import main


def _manifest(path: Path, *, split: str, speaker: str, lecture: str) -> None:
    audio = path.with_suffix(".wav")
    with wave.open(str(audio), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(b"\0\0" * 16_000)
    path.write_text(
        json.dumps(
            {
                "id": f"{split}-1",
                "audioPath": str(audio),
                "reference": "강의 음성",
                "language": "ko-KR",
                "speakerId": speaker,
                "lectureId": lecture,
                "durationMs": 1_000,
                "split": split,
                "terms": [],
                "consent": "AI-Hub-license",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def test_preflight_report_marks_unverified_nemotron_training_as_unsupported(
    tmp_path: Path,
) -> None:
    train = tmp_path / "train.jsonl"
    dev = tmp_path / "dev.jsonl"
    output = tmp_path / "preflight.json"
    _manifest(train, split="train", speaker="speaker-train", lecture="lecture-train")
    _manifest(dev, split="dev", speaker="speaker-dev", lecture="lecture-dev")

    assert (
        main(
            [
                "--train-manifest",
                str(train),
                "--dev-manifest",
                str(dev),
                "--output",
                str(output),
            ]
        )
        == 0
    )

    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["providers"]["whisper"]["status"] == "DRY_RUN_IMPLEMENTED"
    assert report["providers"]["nemotron"]["status"] == "TRAINING_UNSUPPORTED"
