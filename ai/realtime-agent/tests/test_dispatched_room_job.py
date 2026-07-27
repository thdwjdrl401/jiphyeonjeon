from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest

from app.captions.models import CaptionDelta, CaptionStreamCompleted
from app.contracts.live_status import LiveAgentError
from app.jobs.dispatched_room_job import (
    DuplicateSessionJobError,
    InvalidRoomBindingError,
    SessionLeaseLostJobError,
    run_dispatched_room_job,
)
from app.livekit.audio_source import AudioCompletionReason, AudioCompletionRequest
from app.stt.engine import AudioChunk, SttStreamContext, SttStreamStarted
from app.stt.providers.stub import StubStreamingEngine

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"


def _metadata() -> str:
    return json.dumps(
        {
            "contractVersion": "1",
            "sessionId": SESSION_ID,
            "lessonId": LESSON_ID,
            "correlationId": "live-start-1",
        }
    )


class FakeContext:
    def __init__(self, *, assigned_room: str | None = None, connected_room: str | None = None):
        room_name = assigned_room or f"session-{SESSION_ID}"
        self.job = SimpleNamespace(
            id="job-1",
            metadata=_metadata(),
            room=SimpleNamespace(name=room_name),
        )
        self.room = SimpleNamespace(name=connected_room or room_name)
        self.worker_id = "worker-1"
        self.log_context_fields: dict[str, str] = {}


class FakeSource:
    def __init__(self, chunks: list[AudioChunk] | None = None) -> None:
        self._chunks = chunks or [AudioChunk(b"\x00\x00", 48_000, 1, 20)]
        self.connected = False
        self.closed = False
        self._completion_requested = asyncio.Event()
        self._completion_request: AudioCompletionRequest | None = None

    async def connect(self) -> None:
        self.connected = True

    async def chunks(self) -> AsyncIterator[AudioChunk]:
        for chunk in self._chunks:
            yield chunk
        self.request_completion()

    @property
    def completion_request(self) -> AudioCompletionRequest | None:
        return self._completion_request

    def request_completion(
        self,
        reason: AudioCompletionReason = "ROOM_DELETED",
    ) -> None:
        self._completion_request = AudioCompletionRequest(
            reason=reason,
            requested_at_monotonic=time.monotonic(),
        )
        self._completion_requested.set()

    async def wait_completion_requested(self) -> AudioCompletionRequest:
        await self._completion_requested.wait()
        request = self._completion_request
        assert request is not None
        return request

    async def close(self) -> None:
        self.closed = True


class ReasonlessEofSource(FakeSource):
    async def chunks(self) -> AsyncIterator[AudioChunk]:
        for chunk in self._chunks:
            yield chunk


class SourceEofRequestSource(FakeSource):
    async def chunks(self) -> AsyncIterator[AudioChunk]:
        for chunk in self._chunks:
            yield chunk
        self.request_completion("SOURCE_EOF")


class RecordingEngine(StubStreamingEngine):
    def __init__(self) -> None:
        super().__init__(session_id_factory=lambda: "stt-session-1")
        self.stream_context: SttStreamContext | None = None
        self.closed_called = False

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted:
        self.stream_context = context
        return await super().start_stream(context)

    async def close(self) -> None:
        self.closed_called = True
        await super().close()


class BlockingEngine(RecordingEngine):
    def __init__(self) -> None:
        super().__init__()
        self.push_started = asyncio.Event()

    async def push_audio(self, chunk: AudioChunk) -> None:
        del chunk
        self.push_started.set()
        await asyncio.Future()


class FakeLease:
    def __init__(self, *, acquired: bool = True, block_release: bool = False) -> None:
        self._should_acquire = acquired
        self._block_release = block_release
        self.lost = asyncio.Event()
        self.acquire_called = False
        self.release_called = False

    async def acquire(self) -> bool:
        self.acquire_called = True
        return self._should_acquire

    async def wait_lost(self) -> None:
        await self.lost.wait()
        raise RuntimeError("lease owner changed")

    async def release(self) -> None:
        self.release_called = True
        if self._block_release:
            await asyncio.Future()


class FakeReporter:
    def __init__(self, *, fail_state: str | None = None) -> None:
        self.events: list[tuple[str, LiveAgentError | None]] = []
        self.fail_state = fail_state
        self.closed = False

    async def report(self, state, error=None) -> None:
        if state == self.fail_state:
            raise ConnectionError(f"callback failed for {state}")
        self.events.append((state, error))

    async def close(self) -> None:
        self.closed = True


class BlockingSuccessReporter(FakeReporter):
    def __init__(self) -> None:
        super().__init__()
        self.success_started = asyncio.Event()

    async def report(self, state, error=None) -> None:
        if state == "SUCCEEDED":
            self.success_started.set()
            await asyncio.Future()
        await super().report(state, error)


class FakePublisher:
    def __init__(self, *, fail_delta: bool = False, fail_completed: bool = False) -> None:
        self.deltas: list[CaptionDelta] = []
        self.completed: list[CaptionStreamCompleted] = []
        self.fail_delta = fail_delta
        self.fail_completed = fail_completed

    async def publish_delta(self, event: CaptionDelta) -> None:
        if self.fail_delta:
            raise TimeoutError("caption delta timed out")
        self.deltas.append(event)

    async def publish_completed(self, event: CaptionStreamCompleted) -> None:
        if self.fail_completed:
            raise TimeoutError("caption completion timed out")
        self.completed.append(event)


class BlockingCompletionPublisher(FakePublisher):
    def __init__(self) -> None:
        super().__init__()
        self.completion_started = asyncio.Event()

    async def publish_completed(self, event: CaptionStreamCompleted) -> None:
        self.completion_started.set()
        await asyncio.Future()
        self.completed.append(event)


class CompletionThenLeaseLossPublisher(FakePublisher):
    def __init__(self, lease: FakeLease) -> None:
        super().__init__()
        self._lease = lease

    async def publish_completed(self, event: CaptionStreamCompleted) -> None:
        await super().publish_completed(event)
        self._lease.lost.set()
        # Let the lease watcher finish in the same scheduling window as the caption operation.
        await asyncio.sleep(0)


async def _run(
    *,
    context: FakeContext | None = None,
    engine: RecordingEngine | None = None,
    source: FakeSource | None = None,
    lease: FakeLease | None = None,
    reporter: FakeReporter | None = None,
    publisher: FakePublisher | None = None,
    job_kwargs: dict[str, object] | None = None,
):
    context = context or FakeContext()
    engine = engine or RecordingEngine()
    source = source or FakeSource()
    lease = lease or FakeLease()
    reporter = reporter or FakeReporter()
    publisher = publisher or FakePublisher()
    engine_calls = 0
    source_calls = 0

    def engine_factory() -> RecordingEngine:
        nonlocal engine_calls
        engine_calls += 1
        return engine

    def source_factory(_context) -> FakeSource:
        nonlocal source_calls
        source_calls += 1
        return source

    result = await run_dispatched_room_job(
        context,
        engine_factory,
        publisher,
        session_lease_factory=lambda _session_id, _owner_id: lease,
        lifecycle_reporter_factory=lambda _metadata, _job_id: reporter,
        audio_source_factory=source_factory,
        **(job_kwargs or {}),
    )
    return result, engine_calls, source_calls


async def test_wires_one_session_through_lease_stt_caption_and_lifecycle() -> None:
    context = FakeContext()
    engine = RecordingEngine()
    lease = FakeLease()
    reporter = FakeReporter()
    publisher = FakePublisher()

    result, engine_calls, source_calls = await _run(
        context=context,
        engine=engine,
        lease=lease,
        reporter=reporter,
        publisher=publisher,
    )

    assert result.stt_session_id == "stt-session-1"
    assert result.stream_elapsed_ms == 20
    assert engine_calls == source_calls == 1
    assert engine.stream_context == SttStreamContext(stream_id=SESSION_ID, language="ko-KR")
    assert [event.sequence for event in publisher.deltas] == [1]
    assert publisher.deltas[0].text == "[stub]"
    assert publisher.completed[0].reason == "ROOM_DELETED"
    assert publisher.completed[0].last_sequence == 1
    assert [state for state, _error in reporter.events] == [
        "ROOM_CONNECTED",
        "STT_STARTED",
        "AUDIO_STARTED",
        "STOPPING",
        "SUCCEEDED",
    ]
    assert lease.release_called
    assert reporter.closed
    assert engine.closed_called
    assert context.log_context_fields["session_id"] == SESSION_ID
    assert context.log_context_fields["correlation_id"] == "live-start-1"


async def test_invalid_assigned_room_fails_before_lease_engine_and_audio() -> None:
    context = FakeContext(assigned_room="wrong-room")
    lease_factory_called = False
    engine_called = False
    source_called = False

    def lease_factory(_session_id, _owner_id):
        nonlocal lease_factory_called
        lease_factory_called = True
        return FakeLease()

    def engine_factory():
        nonlocal engine_called
        engine_called = True
        return RecordingEngine()

    def source_factory(_context):
        nonlocal source_called
        source_called = True
        return FakeSource()

    with pytest.raises(InvalidRoomBindingError):
        await run_dispatched_room_job(
            context,
            engine_factory,
            FakePublisher(),
            session_lease_factory=lease_factory,
            lifecycle_reporter_factory=lambda _metadata, _job_id: FakeReporter(),
            audio_source_factory=source_factory,
        )

    assert not lease_factory_called
    assert not engine_called
    assert not source_called


async def test_context_room_mismatch_fails_before_caption_or_engine() -> None:
    context = FakeContext(connected_room="different-room")
    publisher = FakePublisher()
    reporter = FakeReporter()

    with pytest.raises(InvalidRoomBindingError, match="context='different-room'"):
        await _run(context=context, publisher=publisher, reporter=reporter)

    assert publisher.deltas == []
    assert publisher.completed == []
    assert reporter.events == []


async def test_duplicate_lease_prevents_engine_and_audio_start() -> None:
    context = FakeContext()
    lease = FakeLease(acquired=False)
    reporter = FakeReporter()
    engine_called = False
    source_called = False
    reporter_factory_called = False

    def engine_factory():
        nonlocal engine_called
        engine_called = True
        return RecordingEngine()

    def source_factory(_context):
        nonlocal source_called
        source_called = True
        return FakeSource()

    def reporter_factory(_metadata, _job_id):
        nonlocal reporter_factory_called
        reporter_factory_called = True
        return reporter

    with pytest.raises(DuplicateSessionJobError):
        await run_dispatched_room_job(
            context,
            engine_factory,
            FakePublisher(),
            session_lease_factory=lambda _session_id, _owner_id: lease,
            lifecycle_reporter_factory=reporter_factory,
            audio_source_factory=source_factory,
        )

    assert not engine_called
    assert not source_called
    assert not reporter_factory_called
    assert not lease.release_called
    assert reporter.events == []


async def test_detected_lease_loss_cancels_core_without_completion() -> None:
    engine = BlockingEngine()
    lease = FakeLease()
    source = FakeSource()
    publisher = FakePublisher()
    reporter = FakeReporter()
    task = asyncio.create_task(
        _run(
            engine=engine,
            lease=lease,
            source=source,
            publisher=publisher,
            reporter=reporter,
        )
    )
    await asyncio.wait_for(engine.push_started.wait(), timeout=1)

    lease.lost.set()

    with pytest.raises(SessionLeaseLostJobError):
        await asyncio.wait_for(task, timeout=1)
    assert publisher.completed == []
    assert engine.closed_called
    assert source.closed
    assert reporter.events[-1] == (
        "FAILED",
        LiveAgentError(
            code="SESSION_LEASE_LOST",
            message="realtime-agent lost ownership of the session",
            retryable=True,
        ),
    )


async def test_reasonless_audio_eof_never_publishes_completion_or_success() -> None:
    source = ReasonlessEofSource()
    publisher = FakePublisher()
    reporter = FakeReporter()

    with pytest.raises(RuntimeError, match="without an explicit completion request"):
        await _run(source=source, publisher=publisher, reporter=reporter)

    assert publisher.completed == []
    assert all(state != "SUCCEEDED" for state, _error in reporter.events)
    assert reporter.events[-1][0] == "FAILED"
    assert source.closed


async def test_non_room_deleted_completion_request_never_closes_caption_stream() -> None:
    source = SourceEofRequestSource()
    publisher = FakePublisher()
    reporter = FakeReporter()

    with pytest.raises(RuntimeError, match="ROOM_DELETED"):
        await _run(source=source, publisher=publisher, reporter=reporter)

    assert publisher.completed == []
    assert all(state != "SUCCEEDED" for state, _error in reporter.events)
    assert reporter.events[-1][0] == "FAILED"


async def test_job_cancellation_cleans_up_without_completion_or_success() -> None:
    engine = BlockingEngine()
    lease = FakeLease()
    source = FakeSource()
    publisher = FakePublisher()
    reporter = FakeReporter()
    task = asyncio.create_task(
        _run(
            engine=engine,
            lease=lease,
            source=source,
            publisher=publisher,
            reporter=reporter,
        )
    )
    await asyncio.wait_for(engine.push_started.wait(), timeout=1)

    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert publisher.completed == []
    assert all(state != "SUCCEEDED" for state, _error in reporter.events)
    assert reporter.events[-1][0] == "FAILED"
    assert engine.closed_called
    assert source.closed
    assert lease.release_called
    assert reporter.closed


async def test_lease_loss_during_completion_publish_cancels_terminal_write() -> None:
    lease = FakeLease()
    publisher = BlockingCompletionPublisher()
    reporter = FakeReporter()
    task = asyncio.create_task(
        _run(
            lease=lease,
            publisher=publisher,
            reporter=reporter,
        )
    )
    await asyncio.wait_for(publisher.completion_started.wait(), timeout=1)

    lease.lost.set()

    with pytest.raises(SessionLeaseLostJobError):
        await asyncio.wait_for(task, timeout=1)
    assert publisher.completed == []
    assert all(state != "SUCCEEDED" for state, _error in reporter.events)
    assert all(state != "FAILED" for state, _error in reporter.events)


async def test_completion_publish_cannot_outlive_shared_shutdown_deadline() -> None:
    publisher = BlockingCompletionPublisher()
    reporter = FakeReporter()
    task = asyncio.create_task(
        _run(
            publisher=publisher,
            reporter=reporter,
            job_kwargs={
                "shutdown_timeout_seconds": 0.05,
                "drain_timeout_seconds": 0.2,
                "cleanup_timeout_seconds": 0.02,
            },
        )
    )
    await asyncio.wait_for(publisher.completion_started.wait(), timeout=1)

    with pytest.raises(TimeoutError):
        await asyncio.wait_for(task, timeout=1)

    assert publisher.completed == []
    assert all(state != "SUCCEEDED" for state, _error in reporter.events)


async def test_cancellation_after_committed_completion_never_reports_failed() -> None:
    reporter = BlockingSuccessReporter()
    publisher = FakePublisher()
    task = asyncio.create_task(_run(publisher=publisher, reporter=reporter))
    await asyncio.wait_for(reporter.success_started.wait(), timeout=1)

    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(publisher.completed) == 1
    assert all(state != "FAILED" for state, _error in reporter.events)


async def test_lease_loss_after_committed_completion_never_reports_failed() -> None:
    lease = FakeLease()
    reporter = BlockingSuccessReporter()
    publisher = FakePublisher()
    task = asyncio.create_task(_run(lease=lease, publisher=publisher, reporter=reporter))
    await asyncio.wait_for(reporter.success_started.wait(), timeout=1)

    lease.lost.set()

    with pytest.raises(SessionLeaseLostJobError):
        await asyncio.wait_for(task, timeout=1)
    assert len(publisher.completed) == 1
    assert all(state != "FAILED" for state, _error in reporter.events)


async def test_simultaneous_completion_and_lease_loss_never_reports_failed() -> None:
    lease = FakeLease()
    publisher = CompletionThenLeaseLossPublisher(lease)
    reporter = FakeReporter()

    with pytest.raises(SessionLeaseLostJobError):
        await _run(lease=lease, publisher=publisher, reporter=reporter)

    assert len(publisher.completed) == 1
    assert all(state != "FAILED" for state, _error in reporter.events)


@pytest.mark.parametrize("failure_point", ["delta", "completed"])
async def test_caption_publish_failure_never_reports_success(failure_point: str) -> None:
    publisher = FakePublisher(
        fail_delta=failure_point == "delta",
        fail_completed=failure_point == "completed",
    )
    reporter = FakeReporter()

    with pytest.raises(TimeoutError, match="caption"):
        await _run(publisher=publisher, reporter=reporter)

    assert all(state != "SUCCEEDED" for state, _error in reporter.events)
    assert publisher.completed == []
    if failure_point == "delta":
        assert reporter.events[-1][0] == "FAILED"
    else:
        # A completion write failure can mean "committed, response lost". Once that write starts,
        # the agent leaves terminal callback absent instead of emitting a contradictory FAILED.
        assert all(state != "FAILED" for state, _error in reporter.events)


async def test_nonterminal_callback_failure_does_not_stop_captioning() -> None:
    reporter = FakeReporter(fail_state="AUDIO_STARTED")
    publisher = FakePublisher()

    await _run(reporter=reporter, publisher=publisher)

    assert len(publisher.deltas) == 1
    assert len(publisher.completed) == 1
    assert reporter.events[-1][0] == "SUCCEEDED"
