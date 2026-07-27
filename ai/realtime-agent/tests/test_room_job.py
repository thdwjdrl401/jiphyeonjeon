from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from app.jobs.room_job import UnexpectedAudioEofError, run_room_job
from app.livekit.audio_source import AudioCompletionReason, AudioCompletionRequest
from app.stt.engine import (
    AudioChunk,
    EngineCompleted,
    EngineEvent,
    SttStreamContext,
    SttStreamStarted,
    TextDelta,
)
from app.stt.providers.stub import StubStreamingEngine


@dataclass
class FakeRoom:
    name: str


class FakeContext:
    def __init__(self, *, assigned_room: str = "room-1", connected_room: str = "") -> None:
        self.job = SimpleNamespace(id="job-1", room=FakeRoom(assigned_room))
        self.room = FakeRoom(connected_room)
        self.worker_id = "worker-1"
        self.log_context_fields: dict[str, str] = {}


class FakeAudioSource:
    def __init__(
        self,
        context: FakeContext,
        chunks: list[AudioChunk],
        *,
        connected_room: str = "room-1",
    ) -> None:
        self._context = context
        self._chunks = chunks
        self._connected_room = connected_room
        self.connect_calls = 0
        self.chunks_calls = 0
        self.close_calls = 0
        self._completion_requested = asyncio.Event()
        self._completion_request: AudioCompletionRequest | None = None

    async def connect(self) -> None:
        self.connect_calls += 1
        self._context.room.name = self._connected_room

    async def chunks(self) -> AsyncIterator[AudioChunk]:
        self.chunks_calls += 1
        for chunk in self._chunks:
            yield chunk
        self.request_completion()

    @property
    def completion_request(self) -> AudioCompletionRequest | None:
        return self._completion_request

    def request_completion(
        self,
        reason: AudioCompletionReason = "SOURCE_EOF",
        *,
        requested_at_monotonic: float | None = None,
    ) -> None:
        self._completion_request = AudioCompletionRequest(
            reason=reason,
            requested_at_monotonic=(
                time.monotonic() if requested_at_monotonic is None else requested_at_monotonic
            ),
        )
        self._completion_requested.set()

    async def wait_completion_requested(self) -> AudioCompletionRequest:
        await self._completion_requested.wait()
        request = self._completion_request
        assert request is not None
        return request

    async def close(self) -> None:
        self.close_calls += 1


class RecordingEngine(StubStreamingEngine):
    def __init__(self) -> None:
        super().__init__(delta="delta", session_id_factory=lambda: "stt-1")
        self.start_context: SttStreamContext | None = None
        self.pushed: list[AudioChunk] = []
        self.close_calls = 0

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted:
        self.start_context = context
        return await super().start_stream(context)

    async def push_audio(self, chunk: AudioChunk) -> None:
        self.pushed.append(chunk)
        await super().push_audio(chunk)

    async def close(self) -> None:
        self.close_calls += 1
        await super().close()


def audio_chunk(elapsed_ms: int) -> AudioChunk:
    return AudioChunk(
        pcm=f"pcm-{elapsed_ms}".encode(),
        sample_rate=48_000,
        num_channels=1,
        stream_elapsed_ms=elapsed_ms,
    )


async def test_room_job_pumps_each_chunk_once_and_drains_engine_events() -> None:
    context = FakeContext()
    chunks = [audio_chunk(20), audio_chunk(40)]
    source = FakeAudioSource(context, chunks)
    engine = RecordingEngine()
    events: list[EngineEvent] = []

    async def record_event(event: EngineEvent) -> None:
        events.append(event)

    result = await run_room_job(
        context,
        engine,
        record_event,
        audio_source_factory=lambda _context: source,
    )

    assert source.connect_calls == 1
    assert source.chunks_calls == 1
    assert source.close_calls == 1
    assert engine.pushed == chunks
    assert engine.start_context == SttStreamContext(stream_id="job-1")
    assert engine.close_calls == 1
    assert [type(event) for event in events] == [TextDelta, TextDelta]
    assert [event.stream_elapsed_ms for event in events] == [20, 40]
    assert result.completion_reason == "SOURCE_EOF"
    assert result.shutdown_deadline > time.monotonic()
    assert context.log_context_fields == {
        "room_name": "room-1",
        "job_id": "job-1",
        "worker_id": "worker-1",
    }
    assert not hasattr(context.job, "metadata")


async def test_iterator_eof_without_explicit_completion_fails_closed() -> None:
    context = FakeContext()

    class ReasonlessEofSource(FakeAudioSource):
        async def chunks(self) -> AsyncIterator[AudioChunk]:
            self.chunks_calls += 1
            if False:
                yield audio_chunk(0)

    source = ReasonlessEofSource(context, [])
    engine = RecordingEngine()

    with pytest.raises(
        UnexpectedAudioEofError,
        match="without an explicit completion request",
    ):
        await run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )

    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_room_job_checks_room_after_connect_and_closes_on_mismatch() -> None:
    context = FakeContext(assigned_room="assigned")
    source = FakeAudioSource(context, [], connected_room="connected")
    engine = RecordingEngine()

    with pytest.raises(
        ValueError,
        match="assigned room does not match connected room: assigned != connected",
    ):
        await run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )

    assert source.connect_calls == 1
    assert source.close_calls == 1
    assert engine.start_context is None
    assert engine.close_calls == 1


async def test_room_job_closes_source_and_engine_when_connect_fails() -> None:
    context = FakeContext()
    engine = RecordingEngine()

    class FailingConnectSource(FakeAudioSource):
        async def connect(self) -> None:
            self.connect_calls += 1
            raise ConnectionError("livekit unavailable")

    source = FailingConnectSource(context, [])

    with pytest.raises(ConnectionError, match="livekit unavailable"):
        await run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )

    assert source.close_calls == 1
    assert engine.start_context is None
    assert engine.close_calls == 1


async def test_room_job_closes_source_and_engine_when_engine_start_fails() -> None:
    context = FakeContext()
    source = FakeAudioSource(context, [])

    class FailingStartEngine(RecordingEngine):
        async def start_stream(self, context: SttStreamContext) -> SttStreamStarted:
            self.start_context = context
            raise RuntimeError("provider start failed")

    engine = FailingStartEngine()

    with pytest.raises(RuntimeError, match="provider start failed"):
        await run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )

    assert source.close_calls == 1
    assert engine.start_context == SttStreamContext(stream_id="job-1")
    assert engine.close_calls == 1


async def test_event_sink_failure_cancels_audio_pump_and_closes_resources() -> None:
    context = FakeContext()
    engine = RecordingEngine()

    class BlockingAudioSource(FakeAudioSource):
        async def chunks(self) -> AsyncIterator[AudioChunk]:
            self.chunks_calls += 1
            yield audio_chunk(20)
            await asyncio.Event().wait()

    source = BlockingAudioSource(context, [])

    async def fail_on_event(_event: EngineEvent) -> None:
        raise RuntimeError("sink unavailable")

    with pytest.raises(RuntimeError, match="sink unavailable"):
        await asyncio.wait_for(
            run_room_job(
                context,
                engine,
                fail_on_event,
                audio_source_factory=lambda _context: source,
            ),
            timeout=1,
        )

    assert engine.pushed == [audio_chunk(20)]
    assert source.chunks_calls == 1
    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_sink_failure_during_finish_cancels_blocked_finish() -> None:
    context = FakeContext()
    source = FakeAudioSource(context, [audio_chunk(20)])

    class BlockingFinishEngine(RecordingEngine):
        def __init__(self) -> None:
            super().__init__()
            self.finish_cancelled = False

        async def finish(self) -> None:
            await self._queue.put(TextDelta("final", 20))
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.finish_cancelled = True
                raise

    engine = BlockingFinishEngine()

    async def fail_on_final_delta(event: EngineEvent) -> None:
        if isinstance(event, TextDelta) and event.text == "final":
            raise RuntimeError("sink failed during finish")

    with pytest.raises(RuntimeError, match="sink failed during finish"):
        await asyncio.wait_for(
            run_room_job(
                context,
                engine,
                fail_on_final_delta,
                audio_source_factory=lambda _context: source,
            ),
            timeout=1,
        )

    assert engine.finish_cancelled is True
    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_early_engine_completion_is_not_forwarded_to_sink() -> None:
    context = FakeContext()

    class BlockingAudioSource(FakeAudioSource):
        async def chunks(self) -> AsyncIterator[AudioChunk]:
            self.chunks_calls += 1
            await asyncio.Future()
            yield audio_chunk(0)

    class EarlyCompletionEngine(RecordingEngine):
        async def events(self) -> AsyncIterator[EngineEvent]:
            yield EngineCompleted(0)

    source = BlockingAudioSource(context, [])
    engine = EarlyCompletionEngine()
    events: list[EngineEvent] = []

    async def record_event(event: EngineEvent) -> None:
        events.append(event)

    with pytest.raises(
        RuntimeError,
        match="STT event stream completed before finish was requested",
    ):
        await asyncio.wait_for(
            run_room_job(
                context,
                engine,
                record_event,
                audio_source_factory=lambda _context: source,
            ),
            timeout=1,
        )

    assert events == []
    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_push_failure_cancels_event_consumer_and_closes_resources() -> None:
    context = FakeContext()
    chunks = [audio_chunk(20), audio_chunk(40)]
    source = FakeAudioSource(context, chunks)

    class FailingPushEngine(RecordingEngine):
        async def push_audio(self, chunk: AudioChunk) -> None:
            self.pushed.append(chunk)
            if chunk.stream_elapsed_ms == 40:
                raise RuntimeError("provider unavailable")
            await StubStreamingEngine.push_audio(self, chunk)

    engine = FailingPushEngine()

    with pytest.raises(RuntimeError, match="provider unavailable"):
        await run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )

    assert engine.pushed == chunks
    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_cancellation_closes_source_and_engine() -> None:
    context = FakeContext()
    engine = RecordingEngine()
    connected = asyncio.Event()

    class WaitingAudioSource(FakeAudioSource):
        async def connect(self) -> None:
            await super().connect()
            connected.set()

        async def chunks(self) -> AsyncIterator[AudioChunk]:
            self.chunks_calls += 1
            blocker: asyncio.Future[None] = asyncio.Future()
            await blocker
            yield audio_chunk(0)

    source = WaitingAudioSource(context, [])
    task = asyncio.create_task(
        run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )
    )
    await connected.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_primary_failure_is_not_masked_and_all_cleanup_runs() -> None:
    context = FakeContext()

    class FailingCleanupSource(FakeAudioSource):
        async def connect(self) -> None:
            raise ConnectionError("primary failure")

        async def close(self) -> None:
            self.close_calls += 1
            raise RuntimeError("source cleanup failure")

    class FailingCleanupEngine(RecordingEngine):
        async def close(self) -> None:
            self.close_calls += 1
            raise RuntimeError("engine cleanup failure")

    source = FailingCleanupSource(context, [])
    engine = FailingCleanupEngine()

    with pytest.raises(ConnectionError, match="primary failure"):
        await run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )

    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_cleanup_failure_is_reported_after_other_cleanup_runs() -> None:
    context = FakeContext()

    class FailingCleanupSource(FakeAudioSource):
        async def close(self) -> None:
            self.close_calls += 1
            raise RuntimeError("source cleanup failure")

    source = FailingCleanupSource(context, [])
    engine = RecordingEngine()

    with pytest.raises(RuntimeError, match="source cleanup failure"):
        await run_room_job(
            context,
            engine,
            _record_nothing,
            audio_source_factory=lambda _context: source,
        )

    assert source.close_calls == 1
    assert engine.close_calls == 1


async def _record_nothing(_event: EngineEvent) -> None:
    return None
