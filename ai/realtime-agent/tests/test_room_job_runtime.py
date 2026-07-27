from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from types import SimpleNamespace

import pytest
from livekit import rtc
from livekit.agents import AutoSubscribe

from app.jobs.room_job import (
    RoomJobCleanupTimeoutError,
    RoomJobDrainTimeoutError,
    RoomJobLifecycleEvent,
    run_room_job,
)
from app.jobs.shutdown_deadline import ShutdownDeadline
from app.livekit.audio_source import (
    AudioCompletionRequest,
    AudioSourceError,
    LiveKitInstructorAudioSource,
)
from app.stt.engine import (
    AudioChunk,
    EngineEvent,
    SttStreamContext,
    SttStreamStarted,
    TextDelta,
)
from app.stt.providers.stub import StubStreamingEngine


class FakeRoom:
    def __init__(self, name: str = "room-1") -> None:
        self.name = name
        self.handlers: dict[str, Callable[..., None]] = {}
        self.remote_participants: dict[str, object] = {}

    def on(self, event: str, callback: Callable[..., None]) -> None:
        self.handlers[event] = callback

    def off(self, event: str, callback: Callable[..., None]) -> None:
        if self.handlers.get(event) == callback:
            self.handlers.pop(event)


class FakeContext:
    def __init__(self) -> None:
        self.job = SimpleNamespace(
            id="job-1",
            room=SimpleNamespace(name="room-1"),
        )
        self.room = FakeRoom()
        self.worker_id = "worker-1"
        self.log_context_fields: dict[str, str] = {}
        self.auto_subscribe: AutoSubscribe | None = None

    async def connect(self, *, auto_subscribe: AutoSubscribe) -> None:
        self.auto_subscribe = auto_subscribe


class CountingAudioSource(LiveKitInstructorAudioSource):
    def __init__(self, context: FakeContext) -> None:
        super().__init__(context)  # type: ignore[arg-type]
        self.chunks_calls = 0
        self.close_calls = 0

    async def chunks(self) -> AsyncIterator[AudioChunk]:
        self.chunks_calls += 1
        async for chunk in super().chunks():
            yield chunk

    async def close(self) -> None:
        self.close_calls += 1
        await super().close()


class CountingEngine(StubStreamingEngine):
    def __init__(self) -> None:
        super().__init__(delta="delta", session_id_factory=lambda: "stt-runtime-1")
        self.start_context: SttStreamContext | None = None
        self.start_called = asyncio.Event()
        self.finish_calls = 0
        self.close_calls = 0

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted:
        self.start_context = context
        started = await super().start_stream(context)
        self.start_called.set()
        return started

    async def finish(self) -> None:
        self.finish_calls += 1
        await super().finish()

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


async def discard_event(_event: EngineEvent) -> None:
    return None


async def test_livekit_room_deleted_is_normal_eof_without_dropping_full_backlog() -> None:
    context = FakeContext()
    source = CountingAudioSource(context)
    queued = [audio_chunk((index + 1) * 20) for index in range(250)]
    for chunk in queued:
        source._queue.put_nowait(chunk)

    # livekit-agents 1.6.6 emits exactly this protobuf enum value as the callback argument.
    context.room.handlers["disconnected"](rtc.DisconnectReason.ROOM_DELETED)
    request = await source.wait_completion_requested()

    received = [chunk async for chunk in source.chunks()]

    assert received == queued
    assert request.reason == "ROOM_DELETED"
    assert request.requested_at_monotonic <= time.monotonic()
    assert source.chunks_calls == 1
    await source.close()
    assert source.close_calls == 1
    assert context.room.handlers == {}


async def test_source_close_does_not_manufacture_a_completion_reason() -> None:
    context = FakeContext()
    source = CountingAudioSource(context)
    completion_wait = asyncio.create_task(source.wait_completion_requested())

    await source.close()
    await asyncio.sleep(0)

    assert source.completion_request is None
    assert completion_wait.done() is False
    completion_wait.cancel()
    await asyncio.gather(completion_wait, return_exceptions=True)


async def test_room_deleted_finishes_engine_drains_events_and_returns_result() -> None:
    context = FakeContext()
    context.log_context_fields = {"session_id": "session-1"}
    source = CountingAudioSource(context)
    engine = CountingEngine()
    sink_events: list[EngineEvent] = []
    lifecycle_events: list[RoomJobLifecycleEvent] = []
    factory_started: list[SttStreamStarted] = []

    def sink_factory(started: SttStreamStarted) -> Callable[[EngineEvent], Awaitable[None]]:
        factory_started.append(started)

        async def record(event: EngineEvent) -> None:
            sink_events.append(event)

        return record

    async def observe(event: RoomJobLifecycleEvent) -> None:
        if event.state == "COMPLETED":
            assert source.close_calls == 1
            assert engine.close_calls == 1
        lifecycle_events.append(event)

    supplied_context = SttStreamContext(stream_id="session-stream-1", language="en-US")
    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            event_sink=None,
            audio_source_factory=lambda _context: source,
            event_sink_factory=sink_factory,
            stream_context=supplied_context,
            lifecycle_observer=observe,
        )
    )
    await engine.start_called.wait()
    source._queue.put_nowait(audio_chunk(20))
    context.room.handlers["disconnected"](rtc.DisconnectReason.ROOM_DELETED)
    completion_request = source.completion_request
    assert completion_request is not None

    result = await asyncio.wait_for(job, timeout=1)

    assert result.stt_session_id == "stt-runtime-1"
    assert result.stream_elapsed_ms == 20
    assert result.completion_reason == "ROOM_DELETED"
    assert result.shutdown_deadline == completion_request.requested_at_monotonic + 12.0
    assert engine.start_context is supplied_context
    assert engine.finish_calls == 1
    assert engine.close_calls == 1
    assert source.chunks_calls == 1
    assert source.close_calls == 1
    assert context.auto_subscribe is AutoSubscribe.SUBSCRIBE_NONE
    assert context.log_context_fields == {
        "session_id": "session-1",
        "room_name": "room-1",
        "job_id": "job-1",
        "worker_id": "worker-1",
    }
    assert factory_started == [SttStreamStarted("stt-runtime-1")]
    assert sink_events == [TextDelta("delta", 20)]
    assert [event.state for event in lifecycle_events] == [
        "ROOM_CONNECTED",
        "STT_STARTED",
        "AUDIO_STARTED",
        "STOPPING",
        "COMPLETED",
    ]
    assert lifecycle_events[-1].stream_elapsed_ms == 20
    assert lifecycle_events[-1].completion_reason == "ROOM_DELETED"
    assert lifecycle_events[-1].shutdown_deadline == result.shutdown_deadline


async def test_non_room_deleted_disconnect_is_primary_failure_and_never_finishes() -> None:
    context = FakeContext()

    class FailingCleanupSource(CountingAudioSource):
        async def close(self) -> None:
            await super().close()
            raise RuntimeError("source cleanup failed")

    class FailingCleanupEngine(CountingEngine):
        async def close(self) -> None:
            await super().close()
            raise RuntimeError("engine cleanup failed")

    source = FailingCleanupSource(context)
    engine = FailingCleanupEngine()
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    async def observe(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)

    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=observe,
        )
    )
    await engine.start_called.wait()
    await asyncio.sleep(0)
    context.room.handlers["disconnected"](rtc.DisconnectReason.SERVER_SHUTDOWN)

    with pytest.raises(AudioSourceError, match="track_sid=room") as exc_info:
        await asyncio.wait_for(job, timeout=1)

    assert isinstance(exc_info.value.__cause__, ConnectionError)
    assert "reason=SERVER_SHUTDOWN" in str(exc_info.value.__cause__)
    assert source.completion_request is None
    assert source.chunks_calls == 1
    assert source.close_calls == 1
    assert engine.finish_calls == 0
    assert engine.close_calls == 1
    assert all(event.state not in {"STOPPING", "COMPLETED"} for event in lifecycle_events)


async def test_job_cancellation_closes_once_without_finish_or_completion() -> None:
    context = FakeContext()

    class CompletionTrackingSource(CountingAudioSource):
        def __init__(self, context: FakeContext) -> None:
            super().__init__(context)
            self.completion_wait_cancelled = asyncio.Event()

        async def wait_completion_requested(self) -> AudioCompletionRequest:
            try:
                return await super().wait_completion_requested()
            except asyncio.CancelledError:
                self.completion_wait_cancelled.set()
                raise

    source = CompletionTrackingSource(context)
    engine = CountingEngine()
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    async def observe(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)

    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=observe,
        )
    )
    await engine.start_called.wait()
    await asyncio.sleep(0)

    job.cancel()
    with pytest.raises(asyncio.CancelledError):
        await job

    assert source.chunks_calls == 1
    assert source.close_calls == 1
    assert engine.finish_calls == 0
    assert engine.close_calls == 1
    assert source.completion_request is None
    assert source.completion_wait_cancelled.is_set()
    assert all(event.state not in {"STOPPING", "COMPLETED"} for event in lifecycle_events)


async def test_sink_failure_stops_audio_immediately_without_success_completion() -> None:
    context = FakeContext()
    source = CountingAudioSource(context)
    engine = CountingEngine()
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    async def fail_sink(_event: EngineEvent) -> None:
        raise RuntimeError("caption publish failed")

    async def observe(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)

    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            fail_sink,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=observe,
        )
    )
    await engine.start_called.wait()
    source._queue.put_nowait(audio_chunk(20))

    with pytest.raises(RuntimeError, match="caption publish failed"):
        await asyncio.wait_for(job, timeout=1)

    assert source.chunks_calls == 1
    assert source.close_calls == 1
    assert engine.finish_calls == 0
    assert engine.close_calls == 1
    assert [event.state for event in lifecycle_events] == [
        "ROOM_CONNECTED",
        "STT_STARTED",
        "AUDIO_STARTED",
    ]


async def test_stream_id_shortcut_and_observer_failure_are_fail_closed() -> None:
    context = FakeContext()
    source = CountingAudioSource(context)
    engine = CountingEngine()
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    async def fail_on_audio_started(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)
        if event.state == "AUDIO_STARTED":
            raise RuntimeError("lifecycle observer failed")

    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            stream_id="session-stream-shortcut",
            lifecycle_observer=fail_on_audio_started,
        )
    )
    await engine.start_called.wait()
    source._queue.put_nowait(audio_chunk(20))

    with pytest.raises(RuntimeError, match="lifecycle observer failed"):
        await asyncio.wait_for(job, timeout=1)

    assert engine.start_context == SttStreamContext(stream_id="session-stream-shortcut")
    assert engine.finish_calls == 0
    assert source.close_calls == 1
    assert engine.close_calls == 1
    assert all(event.state != "COMPLETED" for event in lifecycle_events)


async def test_completed_observer_failure_happens_after_successful_cleanup() -> None:
    context = FakeContext()
    source = CountingAudioSource(context)
    engine = CountingEngine()

    async def fail_on_completed(event: RoomJobLifecycleEvent) -> None:
        if event.state == "COMPLETED":
            assert source.close_calls == 1
            assert engine.close_calls == 1
            raise RuntimeError("completion observer failed")

    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=fail_on_completed,
        )
    )
    await engine.start_called.wait()
    context.room.handlers["disconnected"](rtc.DisconnectReason.ROOM_DELETED)

    with pytest.raises(RuntimeError, match="completion observer failed"):
        await asyncio.wait_for(job, timeout=1)

    assert engine.finish_calls == 1
    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_cleanup_failure_prevents_completed_lifecycle_event() -> None:
    context = FakeContext()

    class FailingCleanupSource(CountingAudioSource):
        async def close(self) -> None:
            await super().close()
            raise RuntimeError("source cleanup failed")

    source = FailingCleanupSource(context)
    engine = CountingEngine()
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    async def observe(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)

    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=observe,
        )
    )
    await engine.start_called.wait()
    context.room.handlers["disconnected"](rtc.DisconnectReason.ROOM_DELETED)

    with pytest.raises(RuntimeError, match="source cleanup failed"):
        await asyncio.wait_for(job, timeout=1)

    assert engine.finish_calls == 1
    assert source.close_calls == 1
    assert engine.close_calls == 1
    assert all(event.state != "COMPLETED" for event in lifecycle_events)


async def test_completion_drain_timeout_cancels_audio_and_never_reports_completed() -> None:
    context = FakeContext()
    source = CountingAudioSource(context)
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    class BlockingPushEngine(CountingEngine):
        def __init__(self) -> None:
            super().__init__()
            self.push_started = asyncio.Event()
            self.push_cancelled = asyncio.Event()

        async def push_audio(self, _chunk: AudioChunk) -> None:
            self.push_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.push_cancelled.set()
                raise

    async def observe(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)

    engine = BlockingPushEngine()
    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=observe,
            drain_timeout_seconds=0.02,
            cleanup_timeout_seconds=0.2,
        )
    )
    await engine.start_called.wait()
    source._queue.put_nowait(audio_chunk(20))
    await engine.push_started.wait()
    context.room.handlers["disconnected"](rtc.DisconnectReason.ROOM_DELETED)

    with pytest.raises(RoomJobDrainTimeoutError, match="completion drain exceeded"):
        await asyncio.wait_for(job, timeout=1)

    assert engine.push_cancelled.is_set()
    assert engine.finish_calls == 0
    assert source.close_calls == 1
    assert engine.close_calls == 1
    assert all(event.state not in {"STOPPING", "COMPLETED"} for event in lifecycle_events)


async def test_nested_publisher_timeout_is_not_reclassified_as_drain_timeout() -> None:
    context = FakeContext()
    source = CountingAudioSource(context)
    engine = CountingEngine()
    stopping = asyncio.Event()
    release_sink = asyncio.Event()

    async def timeout_sink(_event: EngineEvent) -> None:
        await release_sink.wait()
        raise TimeoutError("caption publisher timed out")

    async def observe(event: RoomJobLifecycleEvent) -> None:
        if event.state == "STOPPING":
            stopping.set()

    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            timeout_sink,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=observe,
            drain_timeout_seconds=0.5,
        )
    )
    await engine.start_called.wait()
    source._queue.put_nowait(audio_chunk(20))
    context.room.handlers["disconnected"](rtc.DisconnectReason.ROOM_DELETED)
    await stopping.wait()
    release_sink.set()

    with pytest.raises(TimeoutError, match="caption publisher timed out") as exc_info:
        await asyncio.wait_for(job, timeout=1)

    assert not isinstance(exc_info.value, RoomJobDrainTimeoutError)
    assert source.close_calls == 1
    assert engine.close_calls == 1


async def test_cleanup_timeout_is_dedicated_and_prevents_completed_event() -> None:
    context = FakeContext()
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    class BlockingCloseSource(CountingAudioSource):
        def __init__(self, context: FakeContext) -> None:
            super().__init__(context)
            self.close_cancelled = asyncio.Event()

        async def close(self) -> None:
            self.close_calls += 1
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.close_cancelled.set()
                raise

    async def observe(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)

    source = BlockingCloseSource(context)
    engine = CountingEngine()
    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            lifecycle_observer=observe,
            drain_timeout_seconds=0.2,
            cleanup_timeout_seconds=0.02,
        )
    )
    await engine.start_called.wait()
    context.room.handlers["disconnected"](rtc.DisconnectReason.ROOM_DELETED)

    with pytest.raises(RoomJobCleanupTimeoutError, match="cleanup exceeded"):
        await asyncio.wait_for(job, timeout=1)

    assert source.close_calls == 1
    assert source.close_cancelled.is_set()
    assert engine.close_calls == 1
    assert all(event.state != "COMPLETED" for event in lifecycle_events)


async def test_primary_disconnect_failure_survives_cleanup_timeout() -> None:
    context = FakeContext()

    class BlockingCloseSource(CountingAudioSource):
        def __init__(self, context: FakeContext) -> None:
            super().__init__(context)
            self.close_cancelled = asyncio.Event()

        async def close(self) -> None:
            self.close_calls += 1
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.close_cancelled.set()
                raise

    source = BlockingCloseSource(context)
    engine = CountingEngine()
    job = asyncio.create_task(
        run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: source,
            cleanup_timeout_seconds=0.02,
        )
    )
    await engine.start_called.wait()
    await asyncio.sleep(0)
    context.room.handlers["disconnected"](rtc.DisconnectReason.SERVER_SHUTDOWN)

    with pytest.raises(AudioSourceError, match="track_sid=room"):
        await asyncio.wait_for(job, timeout=1)

    assert source.close_calls == 1
    assert source.close_cancelled.is_set()
    assert engine.close_calls == 1
    assert engine.finish_calls == 0


async def test_expired_absolute_deadline_prevents_finish_and_completed_observer() -> None:
    context = FakeContext()
    lifecycle_events: list[RoomJobLifecycleEvent] = []

    class ExpiredCompletionSource:
        def __init__(self) -> None:
            self.completion_request = AudioCompletionRequest(
                reason="SOURCE_EOF",
                requested_at_monotonic=time.monotonic() - 20.0,
            )

        async def connect(self) -> None:
            return None

        async def chunks(self) -> AsyncIterator[AudioChunk]:
            if False:
                yield audio_chunk(0)

        async def wait_completion_requested(self) -> AudioCompletionRequest:
            return self.completion_request

        async def close(self) -> None:
            return None

    async def observe(event: RoomJobLifecycleEvent) -> None:
        lifecycle_events.append(event)

    engine = CountingEngine()

    with pytest.raises(RoomJobDrainTimeoutError, match="completion drain exceeded"):
        await run_room_job(
            context,
            engine,
            discard_event,
            audio_source_factory=lambda _context: ExpiredCompletionSource(),
            lifecycle_observer=observe,
            shutdown_deadline=ShutdownDeadline(total_seconds=12.0),
        )

    assert engine.finish_calls == 0
    assert all(event.state not in {"STOPPING", "COMPLETED"} for event in lifecycle_events)


@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan"), True])
@pytest.mark.parametrize("field", ["drain_timeout_seconds", "cleanup_timeout_seconds"])
async def test_rejects_non_positive_or_non_finite_stage_timeouts(
    field: str,
    value: object,
) -> None:
    kwargs = {field: value}

    with pytest.raises((TypeError, ValueError), match=field):
        await run_room_job(
            FakeContext(),
            CountingEngine(),
            discard_event,
            **kwargs,
        )
