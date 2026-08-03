from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Iterable

import numpy as np
import pytest
from app.audio.segmentation import VadSegmenter

from stt_lab.audio import PcmAudio
from stt_lab.replay import RecordingSegmenter, build_audio_replay, run_engine_replay
from stt_lab.replay_backends import FinalOnlySegmentedEngine
from stt_lab.runners import Transcription

_SAMPLE_RATE = 16_000
_FRAME_MS = 20
_FRAME_SAMPLES = _SAMPLE_RATE * _FRAME_MS // 1_000


class FakeVad:
    def __init__(self, decisions: Iterable[bool]) -> None:
        self._decisions = iter(decisions)

    def is_speech(self, frame: bytes, sample_rate: int) -> bool:
        assert len(frame) == _FRAME_SAMPLES * 2
        assert sample_rate == _SAMPLE_RATE
        return next(self._decisions)


class FakeTranscriber:
    model_id = "fake-model"
    precision = "float32"

    def __init__(self, text: str = "운영 VAD 결과") -> None:
        self._text = text
        self.seen_audio: list[PcmAudio] = []

    def load(self) -> None:
        return None

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription:
        assert language == "ko-KR"
        self.seen_audio.append(audio)
        return Transcription(self._text, first_delta_ms=1.0, total_ms=2.0)

    def close(self) -> None:
        return None


class FakeClock:
    def __init__(self) -> None:
        self.now_s = 0.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now_s

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now_s += seconds


def _audio(frame_values: Iterable[int]) -> PcmAudio:
    samples = np.concatenate(
        [np.full(_FRAME_SAMPLES, value, dtype=np.int16) for value in frame_values]
    )
    pcm = samples.astype("<i2", copy=False).tobytes()
    return PcmAudio(
        samples=samples,
        sample_rate=_SAMPLE_RATE,
        duration_ms=round(samples.size * 1_000 / _SAMPLE_RATE),
        sha256=hashlib.sha256(pcm).hexdigest(),
    )


def _recording_segmenter(*, clock=None) -> RecordingSegmenter:
    segmenter = VadSegmenter(
        frame_ms=20,
        pad_ms=20,
        min_speech_ms=40,
        max_speech_ms=1_000,
        silence_close_ms=40,
        vad=FakeVad([False, True, True, False, False]),
    )
    return RecordingSegmenter(segmenter, **({"clock": clock} if clock else {}))


def test_build_audio_replay_uses_20ms_frames_without_inventing_tail_silence() -> None:
    samples = np.arange(_FRAME_SAMPLES + 1, dtype=np.int16)
    audio = PcmAudio(samples, _SAMPLE_RATE, 20, "unused")

    replay = build_audio_replay(audio)

    assert len(replay.chunks) == 2
    assert [chunk.stream_elapsed_ms for chunk in replay.chunks] == [20, 20]
    assert replay.padded_samples == 0
    reconstructed = b"".join(chunk.pcm for chunk in replay.chunks)
    assert reconstructed == samples.astype("<i2", copy=False).tobytes()
    assert len(replay.chunks[-1].pcm) == 2


def test_accuracy_replay_uses_product_vad_segments_for_final_only_backend() -> None:
    audio = _audio(range(1, 6))
    replay = build_audio_replay(audio)
    recorder = _recording_segmenter()
    transcriber = FakeTranscriber()
    engine = FinalOnlySegmentedEngine(
        provider="fake",
        transcriber=transcriber,
        segmenter=recorder,
    )

    execution = asyncio.run(
        run_engine_replay(
            engine,
            recorder,
            replay,
            stream_id="clip-1",
            language="ko-KR",
            mode="accuracy",
        )
    )

    assert execution.transcript == "운영 VAD 결과"
    assert execution.source_duration_ms == 100
    assert execution.replay_duration_ms == 100
    assert len(execution.segment_plan) == 1
    plan = execution.segment_plan[0]
    assert (plan.start_ms, plan.end_ms, plan.boundary_reason) == (20, 60, "SILENCE")
    assert plan.pcm_sha256 == hashlib.sha256(audio.samples.tobytes()).hexdigest()
    assert [event.kind for event in execution.events] == ["segmentFinal", "completed"]
    assert transcriber.seen_audio[0].duration_ms == 100


def test_paced_replay_advances_on_the_audio_clock() -> None:
    audio = _audio(range(1, 6))
    replay = build_audio_replay(audio)
    clock = FakeClock()
    recorder = _recording_segmenter(clock=clock)
    engine = FinalOnlySegmentedEngine(
        provider="fake",
        transcriber=FakeTranscriber(),
        segmenter=recorder,
    )

    execution = asyncio.run(
        run_engine_replay(
            engine,
            recorder,
            replay,
            stream_id="clip-paced",
            language="ko-KR",
            mode="paced",
            clock=clock,
            sleep=clock.sleep,
        )
    )

    assert clock.sleeps == pytest.approx([0.02] * 5)
    assert execution.wall_ms == pytest.approx(100.0)
    assert execution.segment_plan[0].ready_wall_ms == pytest.approx(100.0)
    assert execution.events[-1].kind == "completed"
