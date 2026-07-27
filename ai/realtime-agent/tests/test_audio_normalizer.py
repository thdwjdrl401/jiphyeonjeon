from __future__ import annotations

import struct

import pytest

from app.audio.normalizer import Pcm16Normalizer
from app.stt.engine import AudioChunk


def test_normalizer_preserves_mono_pcm_at_target_rate() -> None:
    pcm = struct.pack("<hhh", 100, -200, 300)

    normalized = Pcm16Normalizer().normalize(AudioChunk(pcm, 16_000, 1, 20))

    assert normalized == pcm


def test_normalizer_downmixes_stereo_and_resamples_48k_to_16k() -> None:
    stereo = struct.pack("<" + "hh" * 960, *([1000, 3000] * 960))

    normalized = Pcm16Normalizer().normalize(AudioChunk(stereo, 48_000, 2, 20))

    assert len(normalized) == 320 * 2
    assert set(struct.unpack("<" + "h" * 320, normalized)) == {2000}


def test_normalizer_preserves_resampler_state_across_chunk_boundaries() -> None:
    samples = [(index % 2_000) - 1_000 for index in range(1_001)]
    pcm = struct.pack("<" + "h" * len(samples), *samples)
    split_at = 334 * 2
    normalizer = Pcm16Normalizer()

    split_result = b"".join(
        [
            normalizer.normalize(AudioChunk(pcm[:split_at], 48_000, 1, 7)),
            normalizer.normalize(AudioChunk(pcm[split_at:], 48_000, 1, 21)),
        ]
    )
    whole_result = Pcm16Normalizer().normalize(AudioChunk(pcm, 48_000, 1, 21))

    assert split_result == whole_result


def test_normalizer_rejects_unsupported_channel_count() -> None:
    with pytest.raises(ValueError, match="unsupported channel count: 3"):
        Pcm16Normalizer().normalize(AudioChunk(b"\0" * 6, 16_000, 3, 20))


@pytest.mark.parametrize(
    ("pcm", "num_channels"),
    [(b"\0", 1), (b"\0" * 3, 2)],
)
def test_normalizer_rejects_incomplete_pcm16_frames(
    pcm: bytes,
    num_channels: int,
) -> None:
    with pytest.raises(ValueError, match="incomplete PCM16 frame"):
        Pcm16Normalizer().normalize(AudioChunk(pcm, 16_000, num_channels, 20))


def test_normalizer_rejects_source_sample_rate_changes() -> None:
    normalizer = Pcm16Normalizer()
    normalizer.normalize(AudioChunk(b"\0" * 6, 48_000, 1, 1))

    with pytest.raises(ValueError, match="source sample rate changed: 48000 -> 44100"):
        normalizer.normalize(AudioChunk(b"\0" * 6, 44_100, 1, 2))


def test_normalizer_target_rate_is_fixed_for_its_lifetime() -> None:
    normalizer = Pcm16Normalizer(24_000)

    assert normalizer.target_rate == 24_000
    with pytest.raises(AttributeError):
        normalizer.target_rate = 16_000
