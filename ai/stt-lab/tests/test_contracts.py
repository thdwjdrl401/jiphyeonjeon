from __future__ import annotations

import hashlib
import json
import wave
from pathlib import Path

import pytest

from stt_lab.audio import read_pcm16_mono_wav
from stt_lab.contracts import load_manifest


def _write_wav(path: Path, *, sample_rate: int = 16_000, channels: int = 1) -> None:
    with wave.open(str(path), "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(b"\x00\x00" * sample_rate * channels)


def _clip(audio_path: str = "clip.wav") -> dict[str, object]:
    return {
        "id": "golden-ko-001",
        "audioPath": audio_path,
        "reference": "라이브킷 연결을 확인합니다.",
        "language": "ko-KR",
        "speakerId": "speaker-001",
        "split": "golden",
        "terms": ["LiveKit"],
        "consent": "internal-evaluation",
    }


def _write_manifest(path: Path, *clips: dict[str, object]) -> None:
    path.write_text(
        "\n".join(json.dumps(clip, ensure_ascii=False) for clip in clips) + "\n",
        encoding="utf-8",
    )


def test_manifest_resolves_relative_audio_and_reads_pcm_contract(tmp_path: Path) -> None:
    audio_path = tmp_path / "clip.wav"
    manifest_path = tmp_path / "manifest.jsonl"
    _write_wav(audio_path)
    clip = _clip()
    clip["sha256"] = hashlib.sha256(audio_path.read_bytes()).hexdigest()
    _write_manifest(manifest_path, clip)

    loaded = load_manifest(manifest_path)
    audio = read_pcm16_mono_wav(loaded[0].audio_path, expected_sha256=loaded[0].sha256)

    assert loaded[0].audio_path == audio_path
    assert loaded[0].terms == ("LiveKit",)
    assert audio.sample_rate == 16_000
    assert audio.duration_ms == 1_000


def test_manifest_rejects_duplicate_ids(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.jsonl"
    _write_manifest(manifest_path, _clip(), _clip("other.wav"))

    with pytest.raises(ValueError, match="duplicate clip id"):
        load_manifest(manifest_path, require_audio=False)


def test_manifest_rejects_unknown_fields(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.jsonl"
    clip = _clip()
    clip["unexpected"] = True
    _write_manifest(manifest_path, clip)

    with pytest.raises(ValueError, match="unknown fields"):
        load_manifest(manifest_path, require_audio=False)


def test_audio_rejects_non_16khz_wav(tmp_path: Path) -> None:
    audio_path = tmp_path / "clip.wav"
    _write_wav(audio_path, sample_rate=8_000)

    with pytest.raises(ValueError, match="16 kHz"):
        read_pcm16_mono_wav(audio_path)
