from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from uuid import UUID

from app.captions.pipeline import CaptionEventMapper, CaptionPublisher
from app.contracts.live_status import LiveAgentState
from app.jobs.lifecycle import (
    LifecycleFailure,
    LifecycleReporter,
    classify_failure,
    report_nonterminal_best_effort,
)
from app.jobs.metadata import JobMetadata
from app.jobs.room_job import (
    AudioSourceFactory,
    RoomJobLifecycleEvent,
    RoomJobResult,
    run_room_job,
)
from app.jobs.shutdown_deadline import ShutdownDeadline
from app.stt.engine import EngineCompleted, StreamingSttEngine, SttStreamContext, SttStreamStarted


class SessionLease(Protocol):
    async def acquire(self) -> bool: ...

    async def wait_lost(self) -> None: ...

    async def release(self) -> None: ...


EngineFactory = Callable[[], StreamingSttEngine]
SessionLeaseFactory = Callable[[UUID, str], SessionLease]
LifecycleReporterFactory = Callable[[JobMetadata, str], LifecycleReporter]


class InvalidRoomBindingError(LifecycleFailure):
    error_code = "INVALID_ROOM_BINDING"
    public_message = "dispatch session does not match the LiveKit room"
    retryable = False


class DuplicateSessionJobError(LifecycleFailure):
    error_code = "DUPLICATE_SESSION"
    public_message = "another realtime-agent job already owns this session"
    retryable = False


class SessionLeaseLostJobError(LifecycleFailure):
    error_code = "SESSION_LEASE_LOST"
    public_message = "realtime-agent lost ownership of the session"
    retryable = True


class InvalidCompletionReasonJobError(LifecycleFailure):
    error_code = "INVALID_COMPLETION_REASON"
    public_message = "realtime-agent received an untrusted completion reason"
    retryable = False


class DispatchedJobCleanupTimeoutError(TimeoutError):
    """Outer lease/reporter cleanup exceeded its bounded budget."""


async def run_dispatched_room_job(
    context: Any,
    engine_factory: EngineFactory,
    publisher: CaptionPublisher,
    *,
    session_lease_factory: SessionLeaseFactory,
    lifecycle_reporter_factory: LifecycleReporterFactory,
    audio_source_factory: AudioSourceFactory | None = None,
    language: str = "ko-KR",
    shutdown_timeout_seconds: float = 12.0,
    drain_timeout_seconds: float = 7.0,
    cleanup_timeout_seconds: float = 1.0,
) -> RoomJobResult:
    """Run one strict dispatch without claiming the candidate contract is shared yet."""
    metadata = JobMetadata.parse(context.job.metadata)
    job_id = str(context.job.id)
    expected_room_name = f"session-{metadata.session_id}"
    assigned_room_name = context.job.room.name
    context_room_name = context.room.name
    if assigned_room_name != expected_room_name or context_room_name != expected_room_name:
        raise InvalidRoomBindingError(
            "dispatch room binding does not match the session: "
            f"assigned={assigned_room_name!r}, context={context_room_name!r}, "
            f"expected={expected_room_name!r}"
        )

    context.log_context_fields = {
        "session_id": str(metadata.session_id),
        "lesson_id": str(metadata.lesson_id),
        "room_name": assigned_room_name,
        "job_id": job_id,
        "worker_id": str(context.worker_id),
        "correlation_id": metadata.correlation_id,
    }

    lease = session_lease_factory(metadata.session_id, job_id)
    shutdown_deadline = ShutdownDeadline(shutdown_timeout_seconds)
    reporter: LifecycleReporter | None = None
    lease_task: asyncio.Task[None] | None = None
    lease_acquired = False
    failure: BaseException | None = None
    failure_traceback = None
    result: RoomJobResult | None = None
    completion_terminal_started = asyncio.Event()
    cleanup_failure: BaseException | None = None

    try:
        lease_acquired = await lease.acquire()
        if not lease_acquired:
            raise DuplicateSessionJobError(
                f"active realtime-agent already owns session: {metadata.session_id}"
            )
        reporter = lifecycle_reporter_factory(metadata, job_id)
        lease_task = asyncio.create_task(
            lease.wait_lost(),
            name=f"session-lease:{metadata.session_id}",
        )
        result = await _while_lease_held(
            _run_caption_job(
                context,
                metadata,
                engine_factory,
                publisher,
                reporter,
                shutdown_deadline,
                completion_terminal_started,
                audio_source_factory=audio_source_factory,
                language=language,
                shutdown_timeout_seconds=shutdown_timeout_seconds,
                drain_timeout_seconds=drain_timeout_seconds,
                cleanup_timeout_seconds=cleanup_timeout_seconds,
            ),
            lease_task,
        )
        _require_room_deleted_result(result, shutdown_deadline)
        if not completion_terminal_started.is_set():
            raise RuntimeError("caption completion returned without entering terminal phase")
        # A terminal callback is not best-effort. Its bounded retries use one event body, and a
        # failure is propagated without manufacturing an opposite FAILED terminal event.
        await _while_lease_held(
            _report_succeeded_within_deadline(
                reporter,
                shutdown_deadline,
                shutdown_timeout_seconds,
            ),
            lease_task,
        )
    except BaseException as exc:  # noqa: BLE001 - cancellation also requires owned cleanup
        failure = exc
        failure_traceback = exc.__traceback__
        if reporter is not None and not completion_terminal_started.is_set():
            await _report_failed_without_masking(
                reporter,
                exc,
                shutdown_deadline,
                shutdown_timeout_seconds,
            )
    finally:
        try:
            await _cleanup_dispatched_job(
                lease_task,
                lease if lease_acquired else None,
                reporter,
                shutdown_deadline,
                cleanup_timeout_seconds,
            )
        except BaseException as exc:  # noqa: BLE001 - preserve the primary failure below
            cleanup_failure = exc

    if failure is not None:
        raise failure.with_traceback(failure_traceback)
    if cleanup_failure is not None:
        raise cleanup_failure
    assert result is not None
    return result


async def _run_caption_job(
    context: Any,
    metadata: JobMetadata,
    engine_factory: EngineFactory,
    publisher: CaptionPublisher,
    reporter: LifecycleReporter,
    shutdown_deadline: ShutdownDeadline,
    completion_terminal_started: asyncio.Event,
    *,
    audio_source_factory: AudioSourceFactory | None,
    language: str,
    shutdown_timeout_seconds: float,
    drain_timeout_seconds: float,
    cleanup_timeout_seconds: float,
) -> RoomJobResult:
    mapper: CaptionEventMapper | None = None

    def build_sink(started: SttStreamStarted) -> CaptionEventMapper:
        nonlocal mapper
        mapper = CaptionEventMapper(
            publisher,
            session_id=metadata.session_id,
            lesson_id=metadata.lesson_id,
            stt_session_id=started.stt_session_id,
        )
        return mapper

    async def observe(event: RoomJobLifecycleEvent) -> None:
        if event.state == "AUDIO_STARTED":
            if mapper is None or event.audio_started_at is None:
                raise RuntimeError("caption mapper or audioStartedAt was not bound before audio")
            await mapper.publish_started(event.audio_started_at)

        if event.state == "COMPLETED":
            if mapper is None or event.stream_elapsed_ms is None:
                raise RuntimeError("caption mapper was not bound before completion")
            _require_room_deleted_event(event, shutdown_deadline)
            # Once a remote completion write starts, cancellation/transport failure can make its
            # commit outcome unknowable. From this point onward an opposite FAILED callback would
            # be unsafe even when this coroutine never receives a successful response.
            completion_terminal_started.set()
            async with shutdown_deadline.timeout(shutdown_timeout_seconds):
                await mapper.publish_completed(
                    EngineCompleted(event.stream_elapsed_ms),
                    reason="ROOM_DELETED",
                )
            return
        state = _to_external_state(event.state)
        await report_nonterminal_best_effort(reporter, state)

    engine = engine_factory()
    kwargs: dict[str, object] = {}
    if audio_source_factory is not None:
        kwargs["audio_source_factory"] = audio_source_factory
    return await run_room_job(
        context,
        engine,
        event_sink_factory=build_sink,
        stream_context=SttStreamContext(
            stream_id=str(metadata.session_id),
            language=language,
        ),
        lifecycle_observer=observe,
        shutdown_deadline=shutdown_deadline,
        drain_timeout_seconds=drain_timeout_seconds,
        cleanup_timeout_seconds=cleanup_timeout_seconds,
        **kwargs,
    )


def _to_external_state(room_state: str) -> LiveAgentState:
    if room_state not in {"ROOM_CONNECTED", "STT_STARTED", "AUDIO_STARTED", "STOPPING"}:
        raise ValueError(f"unsupported non-terminal room job state: {room_state}")
    return room_state  # type: ignore[return-value]


def _require_room_deleted_event(
    event: RoomJobLifecycleEvent,
    shutdown_deadline: ShutdownDeadline,
) -> None:
    if event.completion_reason != "ROOM_DELETED":
        raise InvalidCompletionReasonJobError(
            f"caption completion requires ROOM_DELETED, got {event.completion_reason!r}"
        )
    if event.shutdown_deadline is None or event.shutdown_deadline != shutdown_deadline.deadline:
        raise RuntimeError("room job completion did not preserve the shared shutdown deadline")


def _require_room_deleted_result(
    result: RoomJobResult,
    shutdown_deadline: ShutdownDeadline,
) -> None:
    if result.completion_reason != "ROOM_DELETED":
        raise InvalidCompletionReasonJobError(
            f"job success requires ROOM_DELETED, got {result.completion_reason!r}"
        )
    if result.shutdown_deadline != shutdown_deadline.deadline:
        raise RuntimeError("room job result did not preserve the shared shutdown deadline")


async def _report_succeeded_within_deadline(
    reporter: LifecycleReporter,
    shutdown_deadline: ShutdownDeadline,
    timeout_ceiling_seconds: float,
) -> None:
    async with shutdown_deadline.timeout(timeout_ceiling_seconds):
        await reporter.report("SUCCEEDED")


async def _report_failed_without_masking(
    reporter: LifecycleReporter,
    failure: BaseException,
    shutdown_deadline: ShutdownDeadline,
    timeout_ceiling_seconds: float,
) -> None:
    try:
        if shutdown_deadline.started:
            async with shutdown_deadline.timeout(timeout_ceiling_seconds):
                await reporter.report("FAILED", classify_failure(failure))
        else:
            await reporter.report("FAILED", classify_failure(failure))
    except asyncio.CancelledError:
        # Cleanup must finish even when the job task itself was cancelled. The original cancellation
        # is re-raised after cleanup; a callback side-channel never replaces it.
        return
    except Exception:  # noqa: BLE001 - preserve the primary room/lease/publish failure
        return


async def _cleanup_dispatched_job(
    lease_task: asyncio.Task[None] | None,
    lease: SessionLease | None,
    reporter: LifecycleReporter | None,
    shutdown_deadline: ShutdownDeadline,
    cleanup_timeout_seconds: float,
) -> None:
    async def cleanup() -> None:
        if lease_task is not None and not lease_task.done():
            lease_task.cancel()
        if lease_task is not None:
            await asyncio.gather(lease_task, return_exceptions=True)

        cleanup_tasks: list[asyncio.Task[None]] = []
        if lease is not None:
            cleanup_tasks.append(asyncio.create_task(lease.release()))
        if reporter is not None:
            cleanup_tasks.append(asyncio.create_task(reporter.close()))
        if not cleanup_tasks:
            return
        cleanup_results = await asyncio.gather(*cleanup_tasks, return_exceptions=True)
        cleanup_failures = [item for item in cleanup_results if isinstance(item, BaseException)]
        if cleanup_failures:
            raise cleanup_failures[0]

    try:
        if shutdown_deadline.started:
            async with shutdown_deadline.timeout(cleanup_timeout_seconds):
                await cleanup()
        else:
            async with asyncio.timeout(cleanup_timeout_seconds):
                await cleanup()
    except TimeoutError as exc:
        raise DispatchedJobCleanupTimeoutError(
            f"lease/reporter cleanup exceeded {cleanup_timeout_seconds:g} seconds"
        ) from exc


async def _while_lease_held[T](
    operation: Awaitable[T],
    lease_task: asyncio.Task[None],
) -> T:
    operation_task = asyncio.create_task(operation)
    try:
        done, _pending = await asyncio.wait(
            {operation_task, lease_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if lease_task in done:
            if not operation_task.done():
                operation_task.cancel()
            await asyncio.gather(operation_task, return_exceptions=True)
            try:
                await lease_task
            except asyncio.CancelledError:
                raise
            except BaseException as exc:
                raise SessionLeaseLostJobError("session lease was lost") from exc
            raise SessionLeaseLostJobError("session lease ended unexpectedly")

        result = await operation_task
        if lease_task.done():
            try:
                await lease_task
            except asyncio.CancelledError:
                raise
            except BaseException as exc:
                raise SessionLeaseLostJobError("session lease was lost") from exc
            raise SessionLeaseLostJobError("session lease ended unexpectedly")
        return result
    finally:
        if not operation_task.done():
            operation_task.cancel()
        await asyncio.gather(operation_task, return_exceptions=True)
