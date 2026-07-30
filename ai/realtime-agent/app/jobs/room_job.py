from __future__ import annotations

import asyncio
import math
import sys
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

from app.jobs.shutdown_deadline import ShutdownDeadline
from app.livekit.audio_source import (
    AudioCompletionReason,
    AudioCompletionRequest,
    LiveKitInstructorAudioSource,
)
from app.stt.engine import (
    AudioChunk,
    EngineCompleted,
    EngineWarning,
    SegmentFinal,
    StreamingSttEngine,
    SttStreamContext,
    SttStreamStarted,
    TextDelta,
)

_DEFAULT_DRAIN_TIMEOUT_SECONDS = 7.0
_DEFAULT_CLEANUP_TIMEOUT_SECONDS = 1.0


class UnexpectedAudioEofError(RuntimeError):
    """Audio iteration ended without an explicit, trusted completion request."""


class RoomJobDrainTimeoutError(TimeoutError):
    """Post-completion audio/engine draining exceeded its bounded budget."""


class RoomJobCleanupTimeoutError(TimeoutError):
    """Owned task and resource cleanup exceeded its bounded budget."""


class AudioSource(Protocol):
    async def connect(self) -> None: ...

    def chunks(self) -> AsyncIterator[AudioChunk]: ...

    @property
    def completion_request(self) -> AudioCompletionRequest | None: ...

    async def wait_completion_requested(self) -> AudioCompletionRequest: ...

    async def close(self) -> None: ...


AudioSourceFactory = Callable[[Any], AudioSource]
EngineSinkEvent = TextDelta | SegmentFinal | EngineWarning
EngineEventSink = Callable[[EngineSinkEvent], Awaitable[None]]
EngineEventSinkFactory = Callable[[SttStreamStarted], EngineEventSink]
RoomJobLifecycleState = Literal[
    "ROOM_CONNECTED",
    "STT_STARTED",
    "AUDIO_STARTED",
    "STOPPING",
    "COMPLETED",
]


@dataclass(frozen=True, slots=True)
class RoomJobResult:
    stt_session_id: str
    stream_elapsed_ms: int
    completion_reason: AudioCompletionReason
    shutdown_deadline: float


@dataclass(frozen=True, slots=True)
class RoomJobLifecycleEvent:
    state: RoomJobLifecycleState
    stt_session_id: str | None = None
    stream_elapsed_ms: int | None = None
    audio_started_at: datetime | None = None
    completion_reason: AudioCompletionReason | None = None
    shutdown_deadline: float | None = None


RoomJobLifecycleObserver = Callable[[RoomJobLifecycleEvent], Awaitable[None]]


async def run_room_job(
    context: Any,
    engine: StreamingSttEngine,
    event_sink: EngineEventSink | None = None,
    *,
    audio_source_factory: AudioSourceFactory = LiveKitInstructorAudioSource,
    event_sink_factory: EngineEventSinkFactory | None = None,
    stream_context: SttStreamContext | None = None,
    stream_id: str | None = None,
    lifecycle_observer: RoomJobLifecycleObserver | None = None,
    shutdown_deadline: ShutdownDeadline | None = None,
    drain_timeout_seconds: float = _DEFAULT_DRAIN_TIMEOUT_SECONDS,
    cleanup_timeout_seconds: float = _DEFAULT_CLEANUP_TIMEOUT_SECONDS,
) -> RoomJobResult:
    """Connect one LiveKit room job to one streaming STT engine.

    Iterator EOF alone is never success. A source must first publish an explicit completion request;
    every operation after that signal shares one absolute shutdown deadline.
    """
    drain_timeout = _positive_finite(drain_timeout_seconds, "drain_timeout_seconds")
    cleanup_timeout = _positive_finite(cleanup_timeout_seconds, "cleanup_timeout_seconds")
    deadline = shutdown_deadline or ShutdownDeadline()

    assigned_room_name = context.job.room.name
    job_id = str(context.job.id)
    existing_log_fields = dict(getattr(context, "log_context_fields", {}) or {})
    context.log_context_fields = {
        **existing_log_fields,
        "room_name": assigned_room_name,
        "job_id": job_id,
        "worker_id": str(context.worker_id),
    }

    source: AudioSource | None = None
    owned_tasks: set[asyncio.Task[Any]] = set()
    finish_requested = asyncio.Event()
    result: RoomJobResult | None = None

    try:
        _validate_sink_configuration(event_sink, event_sink_factory)
        selected_stream_context = _resolve_stream_context(
            job_id,
            stream_context=stream_context,
            stream_id=stream_id,
        )
        source = audio_source_factory(context)
        await source.connect()
        connected_room_name = context.room.name
        if assigned_room_name != connected_room_name:
            raise ValueError(
                "assigned room does not match connected room: "
                f"{assigned_room_name} != {connected_room_name}"
            )
        await _notify_lifecycle(
            lifecycle_observer,
            RoomJobLifecycleEvent("ROOM_CONNECTED"),
        )

        started = await engine.start_stream(selected_stream_context)
        await _notify_lifecycle(
            lifecycle_observer,
            RoomJobLifecycleEvent(
                "STT_STARTED",
                stt_session_id=started.stt_session_id,
            ),
        )
        selected_event_sink = (
            event_sink_factory(started) if event_sink_factory is not None else event_sink
        )
        if selected_event_sink is None:
            raise TypeError("event_sink_factory must return an event sink")

        event_task = _create_owned_task(
            _consume_engine_events(engine, selected_event_sink, finish_requested),
            owned_tasks,
        )
        audio_task = _create_owned_task(
            _pump_audio(source, engine, lifecycle_observer, started.stt_session_id),
            owned_tasks,
        )
        completion_task = _create_owned_task(
            source.wait_completion_requested(),
            owned_tasks,
        )

        completion = await _wait_for_completion_request(
            source,
            audio_task,
            event_task,
            completion_task,
        )
        shutdown_at = deadline.start(completion.requested_at_monotonic)
        completed_elapsed_ms = await _drain_after_completion(
            engine,
            audio_task,
            event_task,
            finish_requested,
            completion,
            shutdown_at,
            deadline,
            drain_timeout,
            lifecycle_observer,
            started.stt_session_id,
            owned_tasks,
        )
        result = RoomJobResult(
            stt_session_id=started.stt_session_id,
            stream_elapsed_ms=completed_elapsed_ms,
            completion_reason=completion.reason,
            shutdown_deadline=shutdown_at,
        )
    finally:
        active_failure = sys.exception()
        try:
            await _bounded_cleanup(
                owned_tasks,
                source,
                engine,
                deadline,
                cleanup_timeout,
            )
        except BaseException:
            if active_failure is None:
                raise

    if result is None:
        raise RuntimeError("room job ended without a completion result")
    await _notify_lifecycle(
        lifecycle_observer,
        RoomJobLifecycleEvent(
            "COMPLETED",
            stt_session_id=result.stt_session_id,
            stream_elapsed_ms=result.stream_elapsed_ms,
            completion_reason=result.completion_reason,
            shutdown_deadline=result.shutdown_deadline,
        ),
    )
    return result


async def _wait_for_completion_request(
    source: AudioSource,
    audio_task: asyncio.Task[int],
    event_task: asyncio.Task[int],
    completion_task: asyncio.Task[AudioCompletionRequest],
) -> AudioCompletionRequest:
    done, _pending = await asyncio.wait(
        {audio_task, event_task, completion_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    if event_task in done:
        await event_task
        raise RuntimeError("STT event stream completed before audio input")

    if audio_task in done:
        await audio_task
        if completion_task in done:
            return await completion_task
        completion = source.completion_request
        if completion is None:
            raise UnexpectedAudioEofError(
                "audio input ended without an explicit completion request"
            )
        return completion

    return await completion_task


async def _drain_after_completion(
    engine: StreamingSttEngine,
    audio_task: asyncio.Task[int],
    event_task: asyncio.Task[int],
    finish_requested: asyncio.Event,
    completion: AudioCompletionRequest,
    shutdown_at: float,
    deadline: ShutdownDeadline,
    drain_timeout_seconds: float,
    lifecycle_observer: RoomJobLifecycleObserver | None,
    stt_session_id: str,
    owned_tasks: set[asyncio.Task[Any]],
) -> int:
    elapsed_since_request = max(0.0, time.monotonic() - completion.requested_at_monotonic)
    remaining_drain = drain_timeout_seconds - elapsed_since_request
    if remaining_drain <= 0:
        raise RoomJobDrainTimeoutError(
            f"completion drain exceeded {drain_timeout_seconds:g} seconds"
        )

    nested_timeout: TimeoutError | None = None
    try:
        async with deadline.timeout(remaining_drain):
            try:
                if not audio_task.done():
                    done, _pending = await asyncio.wait(
                        {audio_task, event_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if event_task in done:
                        await event_task
                        raise RuntimeError("STT event stream completed before audio drain")

                last_audio_elapsed_ms = await audio_task
                if event_task.done():
                    await event_task
                    raise RuntimeError("STT event stream completed before engine finish")
                await _notify_lifecycle(
                    lifecycle_observer,
                    RoomJobLifecycleEvent(
                        "STOPPING",
                        stt_session_id=stt_session_id,
                        stream_elapsed_ms=last_audio_elapsed_ms,
                        completion_reason=completion.reason,
                        shutdown_deadline=shutdown_at,
                    ),
                )
                finish_task = _create_owned_task(
                    _finish_engine(engine, finish_requested),
                    owned_tasks,
                )
                done, _pending = await asyncio.wait(
                    {finish_task, event_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if event_task in done:
                    completed_elapsed_ms = await event_task
                    await finish_task
                else:
                    await finish_task
                    completed_elapsed_ms = await event_task
                return completed_elapsed_ms
            except TimeoutError as exc:
                nested_timeout = exc
                raise
    except TimeoutError as exc:
        if exc is nested_timeout:
            raise
        raise RoomJobDrainTimeoutError(
            f"completion drain exceeded {drain_timeout_seconds:g} seconds"
        ) from exc


async def _pump_audio(
    source: AudioSource,
    engine: StreamingSttEngine,
    lifecycle_observer: RoomJobLifecycleObserver | None,
    stt_session_id: str,
) -> int:
    first_chunk = True
    last_elapsed_ms = 0
    async for chunk in source.chunks():
        if first_chunk:
            audio_started_at = chunk.audio_started_at or datetime.now(UTC) - timedelta(
                milliseconds=chunk.stream_elapsed_ms
            )
            await _notify_lifecycle(
                lifecycle_observer,
                RoomJobLifecycleEvent(
                    "AUDIO_STARTED",
                    stt_session_id=stt_session_id,
                    stream_elapsed_ms=chunk.stream_elapsed_ms,
                    audio_started_at=audio_started_at,
                ),
            )
            first_chunk = False
        await engine.push_audio(chunk)
        last_elapsed_ms = chunk.stream_elapsed_ms
    return last_elapsed_ms


async def _finish_engine(
    engine: StreamingSttEngine,
    finish_requested: asyncio.Event,
) -> None:
    finish_requested.set()
    await engine.finish()


async def _consume_engine_events(
    engine: StreamingSttEngine,
    event_sink: EngineEventSink,
    finish_requested: asyncio.Event,
) -> int:
    async for event in engine.events():
        if isinstance(event, EngineCompleted):
            if not finish_requested.is_set():
                raise RuntimeError("STT event stream completed before finish was requested")
            return event.stream_elapsed_ms
        await event_sink(event)
    raise RuntimeError("STT event stream ended without completion")


async def _bounded_cleanup(
    owned_tasks: set[asyncio.Task[Any]],
    source: AudioSource | None,
    engine: StreamingSttEngine,
    deadline: ShutdownDeadline,
    cleanup_timeout_seconds: float,
) -> None:
    try:
        if deadline.started:
            async with deadline.timeout(cleanup_timeout_seconds):
                await _cleanup_owned(owned_tasks, source, engine)
        else:
            async with asyncio.timeout(cleanup_timeout_seconds):
                await _cleanup_owned(owned_tasks, source, engine)
    except TimeoutError as exc:
        _cancel_without_waiting(owned_tasks)
        raise RoomJobCleanupTimeoutError(
            f"room job cleanup exceeded {cleanup_timeout_seconds:g} seconds"
        ) from exc


async def _cleanup_owned(
    owned_tasks: set[asyncio.Task[Any]],
    source: AudioSource | None,
    engine: StreamingSttEngine,
) -> None:
    child_tasks = list(owned_tasks)
    for task in child_tasks:
        if not task.done():
            task.cancel()
    if child_tasks:
        await asyncio.gather(*child_tasks, return_exceptions=True)

    close_tasks: list[asyncio.Task[None]] = []
    if source is not None:
        close_tasks.append(_create_owned_task(source.close(), owned_tasks))
    close_tasks.append(_create_owned_task(engine.close(), owned_tasks))
    close_results = await asyncio.gather(*close_tasks, return_exceptions=True)
    close_failures = [result for result in close_results if isinstance(result, BaseException)]
    if close_failures:
        raise close_failures[0]


def _cancel_without_waiting(tasks: set[asyncio.Task[Any]]) -> None:
    for task in tasks:
        if not task.done():
            task.cancel()
        task.add_done_callback(_consume_task_result)


def _consume_task_result(task: asyncio.Task[Any]) -> None:
    try:
        task.exception()
    except BaseException:  # noqa: BLE001 - consume cancellation and terminal task failures
        return


def _create_owned_task[T](
    awaitable: Awaitable[T],
    owned_tasks: set[asyncio.Task[Any]],
) -> asyncio.Task[T]:
    task = asyncio.create_task(awaitable)
    owned_tasks.add(task)
    return task


def _resolve_stream_context(
    job_id: str,
    *,
    stream_context: SttStreamContext | None,
    stream_id: str | None,
) -> SttStreamContext:
    if stream_context is not None and stream_id is not None:
        raise ValueError("stream_context and stream_id are mutually exclusive")
    if stream_context is not None:
        return stream_context
    return SttStreamContext(stream_id=stream_id if stream_id is not None else job_id)


async def _notify_lifecycle(
    observer: RoomJobLifecycleObserver | None,
    event: RoomJobLifecycleEvent,
) -> None:
    if observer is not None:
        await observer(event)


def _validate_sink_configuration(
    event_sink: EngineEventSink | None,
    event_sink_factory: EngineEventSinkFactory | None,
) -> None:
    if (event_sink is None) == (event_sink_factory is None):
        raise ValueError("exactly one of event_sink and event_sink_factory is required")


def _positive_finite(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise TypeError(f"{name} must be a finite number")
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return float(value)
