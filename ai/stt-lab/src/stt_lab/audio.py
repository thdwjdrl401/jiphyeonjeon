from __future__ import annotations

import hashlib
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class PcmAudio:
    samples: np.ndarray
    sample_rate: int
    duration_ms: int
    sha256: str


def read_pcm16_mono_wav(path: Path, *, expected_sha256: str | None = None) -> PcmAudio:
    payload = path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError(f"audio checksum mismatch: {path}")

    try:
        with wave.open(str(path), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            frame_count = source.getnframes()
            compression = source.getcomptype()
            frames = source.readframes(frame_count)
    except (wave.Error, EOFError) as exc:
        raise ValueError(f"audio must be a valid WAV file: {path}") from exc

    if channels != 1 or sample_width != 2 or sample_rate != 16_000 or compression != "NONE":
        raise ValueError("audio must be uncompressed mono 16-bit PCM WAV at 16 kHz")
    samples = np.frombuffer(frames, dtype="<i2").copy()
    duration_ms = round(samples.size * 1_000 / sample_rate)
    if duration_ms <= 0:
        raise ValueError("audio must contain at least one sample")
    return PcmAudio(
        samples=samples,
        sample_rate=sample_rate,
        duration_ms=duration_ms,
        sha256=digest,
    )
