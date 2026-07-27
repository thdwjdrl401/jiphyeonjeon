from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

import pytest

from app.audio.segmentation import SpeechSegment
from app.stt.engine import (
    AudioChunk,
    EngineCapabilities,
    EngineCompleted,
    EngineWarning,
    SttStreamContext,
    TextDelta,
)
from app.stt.providers.segmented import SegmentedStreamingEngine


class FakeSegmenter:
    def __init__(
        self,
        *,
        push_results: list[list[SpeechSegment]] | None = None,
        finish_result: list[SpeechSegment] | None = None,
    ) -> None:
        self._push_results = list(push_results or [])
        self._finish_result = list(finish_result or [])
        self.pushed: list[AudioChunk] = []
        self.finish_calls = 0

    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        self.pushed.append(chunk)
        return self._push_results.pop(0) if self._push_results else []

    def finish(self) -> list[SpeechSegment]:
        self.finish_calls += 1
        return self._finish_result


class RecordingSegmentedEngine(SegmentedStreamingEngine):
    def __init__(
        self,
        segmenter: FakeSegmenter,
        *,
        outputs: dict[bytes, list[str]] | None = None,
        segment_queue_size: int = 8,
        event_queue_size: int = 64,
    ) -> None:
        super().__init__(
            "recording",
            segmenter=segmenter,
            segment_queue_size=segment_queue_size,
            event_queue_size=event_queue_size,
        )
        self._outputs = outputs or {}
        self.transcribed: list[SpeechSegment] = []
        self.close_calls = 0

    async def _transcribe(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> AsyncIterator[str]:
        del context
        self.transcribed.append(segment)
        for text in self._outputs.get(segment.pcm, []):
            yield text

    async def _close_provider(self) -> None:
        self.close_calls += 1


def segment(label: bytes, start_ms: int, end_ms: int) -> SpeechSegment:
    return SpeechSegment(label, 16_000, start_ms, end_ms)


def chunk(elapsed_ms: int) -> AudioChunk:
    return AudioChunk(b"\0\0" * 320, 16_000, 1, elapsed_ms)


async def test_segments_are_transcribed_serially_and_finish_completes_stream(
    caplog: pytest.LogCaptureFixture,
) -> None:
    first = segment(b"first", 0, 20)
    final = segment(b"final", 20, 60)
    segmenter = FakeSegmenter(push_results=[[first], []], finish_result=[final])
    engine = RecordingSegmentedEngine(
        segmenter,
        outputs={b"first": ["one", ""], b"final": ["two"]},
    )
    caplog.set_level(logging.DEBUG, logger="app.stt.providers.segmented")

    started = await engine.start_stream(SttStreamContext("stream-1"))
    await engine.push_audio(chunk(20))
    await engine.push_audio(chunk(80))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()
    await engine.close()

    assert started.stt_session_id.startswith("recording:")
    assert engine.capabilities == EngineCapabilities(16_000, 1, True)
    assert engine.transcribed == [first, final]
    assert segmenter.pushed == [chunk(20), chunk(80)]
    assert segmenter.finish_calls == 1
    assert events == [TextDelta("one", 20), TextDelta("two", 60), EngineCompleted(80)]
    assert engine.close_calls == 1
    segment_logs = [
        message for message in caplog.messages if message.startswith("STT segment processed:")
    ]
    assert len(segment_logs) == 2
    assert "provider=recording segment_duration_ms=20" in segment_logs[0]
    assert "provider=recording segment_duration_ms=40" in segment_logs[1]
    for message in segment_logs:
        assert "provider_wall_latency_ms=" in message
        assert "queue_depth=" in message


async def test_lifecycle_rejects_calls_outside_single_stream_boundary() -> None:
    engine = RecordingSegmentedEngine(FakeSegmenter())

    with pytest.raises(RuntimeError, match="not started"):
        await engine.push_audio(chunk(20))
    with pytest.raises(RuntimeError, match="not started"):
        await engine.finish()
    with pytest.raises(RuntimeError, match="not started"):
        await anext(engine.events())

    await engine.start_stream(SttStreamContext("stream-1"))
    with pytest.raises(RuntimeError, match="already started"):
        await engine.start_stream(SttStreamContext("stream-2"))

    await engine.finish()
    events = [event async for event in engine.events()]
    assert events == [EngineCompleted(0)]

    with pytest.raises(RuntimeError, match="already finishing"):
        await engine.push_audio(chunk(20))
    with pytest.raises(RuntimeError, match="already finishing"):
        await engine.finish()
    with pytest.raises(RuntimeError, match="only be consumed once"):
        await anext(engine.events())

    await engine.close()
    with pytest.raises(RuntimeError, match="closed"):
        await engine.start_stream(SttStreamContext("stream-3"))


async def test_provider_failure_warns_then_raises_without_completion() -> None:
    speech = segment(b"speech", 0, 20)
    segmenter = FakeSegmenter(push_results=[[speech]])

    class FailingEngine(RecordingSegmentedEngine):
        async def _transcribe(
            self,
            segment: SpeechSegment,
            context: SttStreamContext,
        ) -> AsyncIterator[str]:
            del segment, context
            raise RuntimeError("provider failed")
            yield

    engine = FailingEngine(segmenter)
    await engine.start_stream(SttStreamContext("stream-1"))
    await engine.push_audio(chunk(20))

    events = engine.events()
    warning = await anext(events)
    assert warning == EngineWarning("PROVIDER_ERROR", "provider failed")
    with pytest.raises(RuntimeError, match="provider failed"):
        await anext(events)
    with pytest.raises(RuntimeError, match="provider failed"):
        await engine.push_audio(chunk(40))
    with pytest.raises(RuntimeError, match="provider failed"):
        await engine.finish()

    await engine.close()
    await engine.close()
    assert engine.close_calls == 1


async def test_close_cancels_active_transcription_and_closes_provider_once() -> None:
    speech = segment(b"speech", 0, 20)
    segmenter = FakeSegmenter(push_results=[[speech]])
    entered = asyncio.Event()

    class BlockingEngine(RecordingSegmentedEngine):
        def __init__(self) -> None:
            super().__init__(segmenter)
            self.transcription_cancelled = False

        async def _transcribe(
            self,
            segment: SpeechSegment,
            context: SttStreamContext,
        ) -> AsyncIterator[str]:
            del segment, context
            entered.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.transcription_cancelled = True
                raise
            yield

    engine = BlockingEngine()
    await engine.start_stream(SttStreamContext("stream-1"))
    await engine.push_audio(chunk(20))
    await entered.wait()

    await engine.close()
    await engine.close()

    assert engine.transcription_cancelled is True
    assert engine.close_calls == 1


async def test_close_unblocks_an_event_consumer_waiting_for_the_next_event() -> None:
    engine = RecordingSegmentedEngine(FakeSegmenter())
    await engine.start_stream(SttStreamContext("stream-1"))
    events = engine.events()
    waiting = asyncio.create_task(anext(events))
    await asyncio.sleep(0)

    await engine.close()

    with pytest.raises(StopAsyncIteration):
        await asyncio.wait_for(waiting, timeout=1)


async def test_worker_failure_unblocks_finish_waiting_on_full_queue() -> None:
    segments = [segment(str(index).encode(), index * 20, (index + 1) * 20) for index in range(3)]
    segmenter = FakeSegmenter(finish_result=segments)
    entered = asyncio.Event()
    release = asyncio.Event()

    class DelayedFailureEngine(RecordingSegmentedEngine):
        async def _transcribe(
            self,
            segment: SpeechSegment,
            context: SttStreamContext,
        ) -> AsyncIterator[str]:
            del segment, context
            entered.set()
            await release.wait()
            raise RuntimeError("provider failed while queue was full")
            yield

    engine = DelayedFailureEngine(segmenter, segment_queue_size=1)
    await engine.start_stream(SttStreamContext("stream-1"))
    finish_task = asyncio.create_task(engine.finish())
    await entered.wait()
    for _ in range(100):
        if engine._segments.full():
            break
        await asyncio.sleep(0)
    assert engine._segments.full()

    release.set()
    with pytest.raises(RuntimeError, match="provider failed while queue was full"):
        await asyncio.wait_for(finish_task, timeout=1)

    events = engine.events()
    assert isinstance(await anext(events), EngineWarning)
    with pytest.raises(RuntimeError, match="provider failed while queue was full"):
        await anext(events)
    await engine.close()


async def test_bounded_event_queue_backpressures_without_dropping_deltas() -> None:
    speech = segment(b"speech", 0, 20)
    engine = RecordingSegmentedEngine(
        FakeSegmenter(push_results=[[speech]]),
        outputs={b"speech": ["one", "two"]},
        event_queue_size=1,
    )
    await engine.start_stream(SttStreamContext("stream-1"))
    await engine.push_audio(chunk(20))
    await engine.finish()

    for _ in range(100):
        if engine._events.full():
            break
        await asyncio.sleep(0)
    assert engine._events.full()

    assert [event async for event in engine.events()] == [
        TextDelta("one", 20),
        TextDelta("two", 20),
        EngineCompleted(20),
    ]
    await engine.close()
