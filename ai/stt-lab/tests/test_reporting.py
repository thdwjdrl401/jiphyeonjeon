from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from stt_lab.reporting import write_replay_artifacts


def _report() -> dict[str, object]:
    clip = {
        "id": "clip-1",
        "split": "dev",
        "speakerId": "speaker-1",
        "audioSha256": "a" * 64,
        "sourceDurationMs": 1_000,
        "reference": "정답",
        "hypothesis": "정답",
        "normalizedCer": 0.0,
        "literalNormalizedCer": 0.25,
        "referenceAlternativeCount": 1,
        "realTimeFactor": 0.1,
        "segmentPlanSha256": "b" * 64,
        "segmentPlan": [
            {
                "index": 0,
                "startMs": 100,
                "endMs": 700,
                "boundaryReason": "STREAM_END",
                "pcmSha256": "c" * 64,
                "readyWallMs": 20.0,
            }
        ],
        "segments": [],
        "events": [],
    }
    return {
        "schemaVersion": 1,
        "createdAt": "2026-08-03T00:00:00+00:00",
        "codeSha": "d" * 40,
        "manifest": "/data/dev.jsonl",
        "manifestSha256": "e" * 64,
        "split": "dev",
        "mode": "paced",
        "workers": 1,
        "vad": {"frameMs": 20},
        "segmentPlans": {"clip-1": clip["segmentPlan"]},
        "candidates": [
            {
                "name": "whisper-base",
                "backend": "whisper",
                "modelId": "openai/whisper-large-v3",
                "precision": "bfloat16",
                "outputMode": "SEGMENT_FINAL_ONLY",
                "loadMs": 100.0,
                "workerSlots": 1,
                "peakCudaAllocatedBytes": 1_000,
                "peakCudaReservedBytes": 2_000,
                "summary": {
                    "clipCount": 1,
                    "segmentCount": 1,
                    "meanNormalizedCer": 0.0,
                    "meanLiteralNormalizedCer": 0.25,
                    "meanRealTimeFactor": 0.1,
                    "p50SpeechEndToFinalMs": 50.0,
                    "p95SpeechEndToFinalMs": 50.0,
                    "missingFinalCount": 0,
                    "warningCount": 0,
                },
                "clips": [clip],
            }
        ],
    }


def test_replay_report_writes_all_machine_and_human_artifacts(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "run-1"

    paths = write_replay_artifacts(_report(), artifact_dir)

    assert {path.name for path in paths} == {
        "run.json",
        "segment-plan.jsonl",
        "samples.jsonl",
        "summary.json",
        "comparison.csv",
        "report.md",
    }
    run = json.loads((artifact_dir / "run.json").read_text(encoding="utf-8"))
    assert "clips" not in run["candidates"][0]
    assert "summary" not in run["candidates"][0]
    plans = [
        json.loads(line)
        for line in (artifact_dir / "segment-plan.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert plans[0]["audioSha256"] == "a" * 64
    assert plans[0]["segmentPlanSha256"] == "b" * 64
    samples = [
        json.loads(line)
        for line in (artifact_dir / "samples.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert samples[0]["candidate"] == "whisper-base"
    with (artifact_dir / "comparison.csv").open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    assert rows[0]["meanNormalizedCer"] == "0.0"
    assert rows[0]["meanLiteralNormalizedCer"] == "0.25"
    markdown = (artifact_dir / "report.md").read_text(encoding="utf-8")
    assert "COMPARABLE" in markdown
    assert "운영 무결성 gate: **PASS**" in markdown


def test_replay_report_is_deterministic_for_the_same_input(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"

    write_replay_artifacts(_report(), first)
    write_replay_artifacts(_report(), second)

    assert {path.name: path.read_bytes() for path in first.iterdir()} == {
        path.name: path.read_bytes() for path in second.iterdir()
    }


def test_replay_report_fails_on_existing_directory_or_secret_field(tmp_path: Path) -> None:
    existing = tmp_path / "existing"
    existing.mkdir()
    with pytest.raises(FileExistsError):
        write_replay_artifacts(_report(), existing)

    report = _report()
    report["apiKey"] = "must-not-be-written"
    with pytest.raises(ValueError, match="secret field"):
        write_replay_artifacts(report, tmp_path / "unsafe")
    assert not (tmp_path / "unsafe").exists()
