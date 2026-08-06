from __future__ import annotations

import struct
from collections.abc import Iterable

from app.audio.normalizer import Pcm16Normalizer
from app.audio.segmentation import VadSegmenter
from app.stt.engine import AudioChunk

_SAMPLE_RATE = 16_000
_FRAME_MS = 20
_SAMPLES_PER_FRAME = _SAMPLE_RATE * _FRAME_MS // 1_000


class FakeVad:
    def __init__(self, decisions: Iterable[bool]) -> None:
        self._decisions = iter(decisions)

    def is_speech(self, frame: bytes, sample_rate: int) -> bool:
        assert len(frame) == _SAMPLES_PER_FRAME * 2
        assert sample_rate == _SAMPLE_RATE
        return next(self._decisions)


def _frame(value: int) -> bytes:
    return struct.pack("<" + "h" * _SAMPLES_PER_FRAME, *([value] * _SAMPLES_PER_FRAME))


def _chunk(*frames: bytes) -> AudioChunk:
    return AudioChunk(
        pcm=b"".join(frames),
        sample_rate=_SAMPLE_RATE,
        num_channels=1,
        stream_elapsed_ms=len(frames) * _FRAME_MS,
    )


def test_vad_closes_after_minimum_speech_and_silence_with_preroll() -> None:
    frames = [_frame(value) for value in range(1, 6)]
    segmenter = VadSegmenter(
        frame_ms=20,
        activation_ms=20,
        pad_ms=20,
        min_speech_ms=40,
        min_speech_ratio=0.4,
        max_speech_ms=1_000,
        silence_close_ms=40,
        vad=FakeVad([False, True, True, False, False]),
    )

    segments = segmenter.push(_chunk(*frames))

    assert len(segments) == 1
    assert segments[0].pcm == b"".join(frames)
    assert (segments[0].start_ms, segments[0].end_ms) == (20, 60)
    assert segments[0].boundary_reason == "SILENCE"
    assert segments[0].speech_ms == 40
    assert segments[0].segment_ms == 100
    assert segments[0].speech_ratio == 0.4


def test_maximum_bounds_total_buffered_pcm_not_only_speech_time() -> None:
    frames = [_frame(value) for value in range(1, 6)]
    segmenter = VadSegmenter(
        frame_ms=20,
        activation_ms=20,
        pad_ms=0,
        min_speech_ms=40,
        min_speech_ratio=0.4,
        max_speech_ms=100,
        silence_close_ms=100,
        vad=FakeVad([True, False, True, False, False]),
    )

    segments = segmenter.push(_chunk(*frames))

    assert len(segments) == 1
    assert segments[0].pcm == b"".join(frames)
    assert len(segments[0].pcm) == _SAMPLE_RATE * 100 // 1_000 * 2


def test_forced_flush_makes_contiguous_segments_without_retranscribed_overlap() -> None:
    frames = [_frame(value) for value in range(1, 7)]
    segmenter = VadSegmenter(
        frame_ms=20,
        activation_ms=20,
        pad_ms=40,
        min_speech_ms=20,
        max_speech_ms=80,
        silence_close_ms=80,
        vad=FakeVad([True] * len(frames)),
    )

    segments = segmenter.push(_chunk(*frames))
    segments.extend(segmenter.finish())

    assert len(segments) == 2
    assert segments[0].pcm == b"".join(frames[:4])
    assert segments[1].pcm == b"".join(frames[4:])
    assert (segments[0].start_ms, segments[0].end_ms) == (0, 80)
    assert (segments[1].start_ms, segments[1].end_ms) == (80, 120)
    assert segments[0].boundary_reason == "MAX_DURATION"
    assert segments[1].boundary_reason == "STREAM_END"
    assert b"".join(segment.pcm for segment in segments) == b"".join(frames)
    assert all(len(segment.pcm) <= _SAMPLE_RATE * 80 // 1_000 * 2 for segment in segments)


def test_finish_flushes_eligible_tail_once_and_clears_preroll() -> None:
    frames = [_frame(value) for value in range(1, 4)]
    segmenter = VadSegmenter(
        frame_ms=20,
        activation_ms=20,
        pad_ms=20,
        min_speech_ms=40,
        max_speech_ms=1_000,
        silence_close_ms=100,
        vad=FakeVad([False, True, True]),
    )

    assert segmenter.push(_chunk(*frames)) == []
    segments = segmenter.finish()

    assert len(segments) == 1
    assert segments[0].pcm == b"".join(frames)
    assert (segments[0].start_ms, segments[0].end_ms) == (20, 60)
    assert segments[0].boundary_reason == "STREAM_END"
    assert segmenter.finish() == []


def test_short_speech_is_discarded_when_silence_closes_it() -> None:
    segmenter = VadSegmenter(
        frame_ms=20,
        activation_ms=20,
        pad_ms=0,
        min_speech_ms=40,
        max_speech_ms=1_000,
        silence_close_ms=40,
        vad=FakeVad([True, False, False]),
    )

    assert segmenter.push(_chunk(_frame(1), _frame(2), _frame(3))) == []
    assert segmenter.finish() == []


def test_precision_policy_requires_nine_hundred_ms_of_detected_speech() -> None:
    short_frames = [_frame(100) for _ in range(44)]
    short = VadSegmenter(
        activation_ms=120,
        pad_ms=0,
        min_speech_ms=900,
        min_speech_ratio=0.5,
        vad=FakeVad([True] * len(short_frames)),
    )

    assert short.push(_chunk(*short_frames)) == []
    assert short.finish() == []

    eligible_frames = [_frame(100) for _ in range(45)]
    eligible = VadSegmenter(
        activation_ms=120,
        pad_ms=0,
        min_speech_ms=900,
        min_speech_ratio=0.5,
        vad=FakeVad([True] * len(eligible_frames)),
    )

    assert eligible.push(_chunk(*eligible_frames)) == []
    segments = eligible.finish()
    assert len(segments) == 1
    assert segments[0].end_ms - segments[0].start_ms == 900


def test_default_policy_forces_a_boundary_at_fifteen_seconds() -> None:
    frames = [_frame(100) for _ in range(750)]
    segmenter = VadSegmenter(
        pad_ms=0,
        vad=FakeVad([True] * len(frames)),
    )

    segments = segmenter.push(_chunk(*frames))

    assert len(segments) == 1
    assert segments[0].boundary_reason == "MAX_DURATION"
    assert segments[0].segment_ms == 15_000
    assert (segments[0].start_ms, segments[0].end_ms) == (0, 15_000)


def test_activation_requires_six_consecutive_speech_frames() -> None:
    frames = [_frame(100) for _ in range(6)]
    segmenter = VadSegmenter(
        activation_ms=120,
        pad_ms=0,
        min_speech_ms=120,
        min_speech_ratio=1.0,
        vad=FakeVad([True] * len(frames)),
    )

    assert segmenter.push(_chunk(*frames[:5])) == []
    assert segmenter.finish() == []

    eligible = VadSegmenter(
        activation_ms=120,
        pad_ms=0,
        min_speech_ms=120,
        min_speech_ratio=1.0,
        vad=FakeVad([True] * len(frames)),
    )
    assert eligible.push(_chunk(*frames)) == []
    assert len(eligible.finish()) == 1


def test_speech_density_gate_discards_sparse_voice_like_frames() -> None:
    frames = [_frame(100) for _ in range(10)]
    segmenter = VadSegmenter(
        activation_ms=40,
        pad_ms=0,
        min_speech_ms=40,
        min_speech_ratio=0.5,
        silence_close_ms=160,
        vad=FakeVad([True, True, *([False] * 8)]),
    )

    assert segmenter.push(_chunk(*frames)) == []
    assert segmenter.finish() == []


def test_segmenter_preserves_normalizer_state_across_source_chunks() -> None:
    samples = [(index % 2_000) - 1_000 for index in range(1_001)]
    pcm = struct.pack("<" + "h" * len(samples), *samples)
    split_at = 334 * 2
    segmenter = VadSegmenter(
        frame_ms=20,
        activation_ms=20,
        pad_ms=0,
        min_speech_ms=20,
        max_speech_ms=1_000,
        silence_close_ms=100,
        vad=FakeVad([True]),
    )

    assert segmenter.push(AudioChunk(pcm[:split_at], 48_000, 1, 7)) == []
    assert segmenter.push(AudioChunk(pcm[split_at:], 48_000, 1, 21)) == []
    segments = segmenter.finish()
    expected = Pcm16Normalizer().normalize(AudioChunk(pcm, 48_000, 1, 21))

    assert len(segments) == 1
    assert segments[0].pcm == expected[: _SAMPLES_PER_FRAME * 2]
