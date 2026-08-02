from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

from app.captions import CaptionCompleted, CaptionEntry
from app.lecture_notes.models import (
    LectureNote,
    LectureNoteCaptureCompleted,
    LectureNoteChunkAppended,
    LectureNoteEvent,
    LectureNoteModelRequest,
    LectureNoteRefinedSnapshot,
    LectureNoteRefinedTopic,
    LectureNoteRefinementRequest,
    LectureNoteRefinementResult,
    LectureNoteWindow,
    TopicAction,
)
from app.lecture_notes.ports import (
    LectureNoteModel,
    LectureNoteRefinementModel,
    LectureNoteStateStore,
)
from app.lecture_notes.recovery import (
    LectureNoteSessionCheckpoint,
    LectureNoteWorkCheckpoint,
)
from app.lecture_notes.reducer import (
    apply_model_result,
    render_markdown_fragment,
    render_refined_markdown,
)
from app.lecture_notes.windowing import LectureNoteWindowAccumulator

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LectureNoteServiceMetrics:
    windows_enqueued_total: int = 0
    windows_coalesced_total: int = 0
    model_calls_total: int = 0
    model_failures_total: int = 0
    refinement_calls_total: int = 0
    refinement_failures_total: int = 0
    refinements_completed_total: int = 0
    events_published_total: int = 0
    publish_failures_total: int = 0
    checkpoints_saved_total: int = 0
    checkpoint_failures_total: int = 0
    sessions_restored_total: int = 0
    completed_total: int = 0


@dataclass(slots=True)
class _PendingBatch:
    operation_id: str = field(default_factory=lambda: f"op-{uuid4().hex}")
    windows: list[LectureNoteWindow] = field(default_factory=list)
    completion: CaptionCompleted | None = None

    def to_checkpoint(self) -> LectureNoteWorkCheckpoint:
        return LectureNoteWorkCheckpoint(
            operationId=self.operation_id,
            windows=tuple(self.windows),
            completion=self.completion,
        )

    @classmethod
    def from_checkpoint(cls, checkpoint: LectureNoteWorkCheckpoint) -> _PendingBatch:
        return cls(
            operation_id=checkpoint.operationId,
            windows=list(checkpoint.windows),
            completion=checkpoint.completion,
        )


@dataclass(slots=True)
class _SessionState:
    lesson_id: str
    note: LectureNote = field(default_factory=LectureNote)
    pending: _PendingBatch | None = None
    in_flight: _PendingBatch | None = None
    outbox: LectureNoteEvent | None = None
    task: asyncio.Task[None] | None = None
    completed: bool = False
    completion_acked: bool = False
    refinement_pending: bool = False
    refined: bool = False
    deactivated: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class LectureNoteService:
    """세션별 작업을 직렬화하고 처리 경계를 Redis checkpoint에 남긴다."""

    def __init__(
        self,
        model: LectureNoteModel,
        store: LectureNoteStateStore,
        accumulator: LectureNoteWindowAccumulator,
        *,
        refinement_model: LectureNoteRefinementModel | None = None,
    ) -> None:
        self._model = model
        self._refinement_model = refinement_model
        self._store = store
        self._accumulator = accumulator
        self._sessions: dict[str, _SessionState] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._metrics = LectureNoteServiceMetrics()
        self._closed = False

    async def accept(
        self,
        session_id: str,
        lesson_id: str,
        windows: tuple[LectureNoteWindow, ...],
        *,
        completion: CaptionCompleted | None = None,
    ) -> None:
        """caption 작업을 저장한 뒤 반환해 consumer ACK보다 checkpoint가 먼저 오게 한다."""
        if self._closed:
            raise RuntimeError("lecture note service is closed")
        state = self._sessions.get(session_id)
        if state is None:
            state = _SessionState(lesson_id=lesson_id)
            self._sessions[session_id] = state
        elif state.lesson_id != lesson_id:
            raise ValueError("lecture note session cannot change lesson scope")

        async with state.lock:
            if state.completed:
                return
            if windows or completion is not None:
                if state.pending is None:
                    state.pending = _PendingBatch()
                elif windows:
                    self._metrics.windows_coalesced_total += len(windows)
                state.pending.windows.extend(windows)
                state.pending.completion = completion or state.pending.completion
                self._metrics.windows_enqueued_total += len(windows)
            await self._save_checkpoint(session_id, state)
        self._kick(session_id, state)

    async def restore(self) -> None:
        """active index의 checkpoint를 메모리에 복원하고 미완료 작업을 재개한다."""
        for checkpoint in await self._store.load_active():
            self._accumulator.restore_session(checkpoint.accumulator)
            state = _SessionState(
                lesson_id=checkpoint.lessonId,
                note=checkpoint.note,
                pending=_restore_work(checkpoint.pending),
                in_flight=_restore_work(checkpoint.inFlight),
                outbox=checkpoint.outbox,
                completed=checkpoint.completed,
                completion_acked=checkpoint.completionAcked,
                refinement_pending=checkpoint.refinementPending,
                refined=checkpoint.refined,
            )
            self._sessions[checkpoint.sessionId] = state
            self._metrics.sessions_restored_total += 1
            if state.refined and state.completion_acked:
                await self._deactivate(checkpoint.sessionId, state)
            elif (
                state.outbox is not None
                or state.in_flight is not None
                or state.pending
                or state.refinement_pending
            ):
                self._kick(checkpoint.sessionId, state)

    async def mark_completion_acked(self, session_id: str) -> None:
        """caption completion ACK 뒤 terminal checkpoint를 안전하게 정리한다."""
        state = self._sessions.get(session_id)
        if state is None:
            return
        async with state.lock:
            state.completion_acked = True
            if state.refined:
                await self._deactivate(session_id, state)
            else:
                await self._save_checkpoint(session_id, state)

    async def drain(self) -> None:
        while self._tasks:
            await asyncio.gather(*tuple(self._tasks))

    async def aclose(self) -> None:
        self._closed = True
        await self.drain()

    def metrics_snapshot(self) -> dict[str, int]:
        return {
            "windows_enqueued_total": self._metrics.windows_enqueued_total,
            "windows_coalesced_total": self._metrics.windows_coalesced_total,
            "model_calls_total": self._metrics.model_calls_total,
            "model_failures_total": self._metrics.model_failures_total,
            "refinement_calls_total": self._metrics.refinement_calls_total,
            "refinement_failures_total": self._metrics.refinement_failures_total,
            "refinements_completed_total": self._metrics.refinements_completed_total,
            "events_published_total": self._metrics.events_published_total,
            "publish_failures_total": self._metrics.publish_failures_total,
            "checkpoints_saved_total": self._metrics.checkpoints_saved_total,
            "checkpoint_failures_total": self._metrics.checkpoint_failures_total,
            "sessions_restored_total": self._metrics.sessions_restored_total,
            "completed_total": self._metrics.completed_total,
            "tracked_sessions": len(self._sessions),
            "running_tasks": len(self._tasks),
        }

    def _kick(self, session_id: str, state: _SessionState) -> None:
        if state.task is not None or state.deactivated:
            return
        if (
            state.outbox is None
            and state.in_flight is None
            and state.pending is None
            and not state.refinement_pending
        ):
            return
        task = asyncio.create_task(
            self._drain_session(session_id, state),
            name=f"lecture-note:{session_id}",
        )
        state.task = task
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _drain_session(self, session_id: str, state: _SessionState) -> None:
        try:
            while True:
                batch: _PendingBatch | None = None
                should_refine = False
                async with state.lock:
                    if state.outbox is not None:
                        if not await self._commit_outbox(session_id, state):
                            return
                        continue
                    if state.in_flight is None and state.pending is not None:
                        # 모델 호출 전에 durable state도 pending에서 in-flight로 옮긴다.
                        state.in_flight = state.pending
                        state.pending = None
                        await self._save_checkpoint(session_id, state)
                    if state.in_flight is not None:
                        batch = state.in_flight
                    elif state.refinement_pending and not state.refined:
                        should_refine = True
                    else:
                        return
                if should_refine:
                    if not await self._process_refinement(session_id, state):
                        return
                    continue
                if batch is None:  # pragma: no cover - lock 안에서 보장한다
                    return
                if not await self._process_batch(session_id, state, batch):
                    return
        except Exception as exc:
            self._metrics.checkpoint_failures_total += 1
            logger.warning(
                "강의 노트 checkpoint 처리 실패",
                extra={
                    "event": "lecture_note.checkpoint_failed",
                    "session_id": session_id,
                    "error_code": type(exc).__name__,
                },
            )
        finally:
            state.task = None
            # 작업 종료 직전에 새 pending이 들어온 좁은 경합만 이어서 처리한다.
            if (
                not state.completed
                and state.outbox is None
                and state.in_flight is None
                and state.pending is not None
            ):
                self._kick(session_id, state)

    async def _process_batch(
        self,
        session_id: str,
        state: _SessionState,
        batch: _PendingBatch,
    ) -> bool:
        if batch.windows:
            request = _model_request(state.note, batch.windows)
            self._metrics.model_calls_total += 1
            try:
                result = await self._model.generate(request)
            except Exception as exc:
                self._metrics.model_failures_total += 1
                logger.warning(
                    "강의 노트 모델 호출 실패",
                    extra={
                        "event": "lecture_note.model_failed",
                        "session_id": session_id,
                        "error_code": type(exc).__name__,
                    },
                )
                return False

            async with state.lock:
                if state.in_flight is None or state.in_flight.operation_id != batch.operation_id:
                    return True
                previous_note = state.note
                updated_note = apply_model_result(previous_note, result)
                if updated_note == previous_note:
                    state.in_flight.windows.clear()
                    if state.in_flight.completion is None:
                        state.in_flight = None
                    await self._save_checkpoint(session_id, state)
                    return True
                state.note = updated_note
                state.outbox = _chunk_appended_event(
                    previous_note,
                    updated_note,
                    batch.windows[-1],
                )
                await self._save_checkpoint(session_id, state)
                return await self._commit_outbox(session_id, state)

        async with state.lock:
            if state.in_flight is None or state.in_flight.operation_id != batch.operation_id:
                return True
            if state.in_flight.completion is None:
                state.in_flight = None
                await self._save_checkpoint(session_id, state)
                return True
            state.outbox = _capture_completed_event(state.note, state.in_flight.completion)
            await self._save_checkpoint(session_id, state)
            return await self._commit_outbox(session_id, state)

    async def _process_refinement(self, session_id: str, state: _SessionState) -> bool:
        if self._refinement_model is None or not state.note.topics:
            async with state.lock:
                state.refinement_pending = False
                state.refined = True
                await self._save_checkpoint(session_id, state)
                if state.completion_acked:
                    await self._deactivate(session_id, state)
            return True

        self._metrics.refinement_calls_total += 1
        try:
            result = await self._refinement_model.refine(
                LectureNoteRefinementRequest(
                    session_id=session_id,
                    lesson_id=state.lesson_id,
                    note=state.note,
                )
            )
        except Exception as exc:
            self._metrics.refinement_failures_total += 1
            logger.warning(
                "강의 노트 종료 후 정제 실패",
                extra={
                    "event": "lecture_note.refinement_failed",
                    "session_id": session_id,
                    "error_code": type(exc).__name__,
                },
            )
            return False

        async with state.lock:
            if not state.refinement_pending or state.refined:
                return True
            accumulator = self._accumulator.export_session(session_id)
            if accumulator is None:
                raise ValueError("lecture note accumulator state is missing")
            state.outbox = _refined_snapshot_event(
                session_id=session_id,
                lesson_id=state.lesson_id,
                stt_session_id=accumulator.current.sttSessionId,
                note=state.note,
                result=result,
            )
            await self._save_checkpoint(session_id, state)
            return await self._commit_outbox(session_id, state)

    async def reconcile_completion_acks_after_pending_drain(self) -> None:
        """소유 pending에 completion이 없었던 복원 세션의 ACK 완료를 확정한다."""
        for session_id, state in tuple(self._sessions.items()):
            async with state.lock:
                if not state.completed or state.completion_acked:
                    continue
                state.completion_acked = True
                if state.refined:
                    await self._deactivate(session_id, state)
                else:
                    await self._save_checkpoint(session_id, state)

    async def _commit_outbox(self, session_id: str, state: _SessionState) -> bool:
        event = state.outbox
        if event is None:  # pragma: no cover - caller가 보장한다
            return True

        final_state = _state_after_commit(
            state,
            event,
            refinement_enabled=self._refinement_model is not None,
        )
        checkpoint = self._checkpoint(session_id, final_state)
        try:
            await self._store.commit(checkpoint, event)
        except Exception as exc:
            committed = await self._store.load(session_id)
            if committed is None or not _checkpoint_contains_event(committed, event):
                self._metrics.publish_failures_total += 1
                logger.warning(
                    "강의 노트 event 원자 발행 실패",
                    extra={
                        "event": "lecture_note.publish_failed",
                        "session_id": session_id,
                        "note_event_type": event.type,
                        "error_code": type(exc).__name__,
                    },
                )
                return False
            logger.info(
                "강의 노트 event 발행 결과를 checkpoint로 확인",
                extra={
                    "event": "lecture_note.publish_reconciled",
                    "session_id": session_id,
                    "note_event_type": event.type,
                },
            )

        state.note = final_state.note
        state.pending = final_state.pending
        state.in_flight = final_state.in_flight
        state.outbox = None
        state.completed = final_state.completed
        state.completion_acked = final_state.completion_acked
        state.refinement_pending = final_state.refinement_pending
        state.refined = final_state.refined
        self._metrics.events_published_total += 1
        if isinstance(event, LectureNoteCaptureCompleted):
            self._metrics.completed_total += 1
        elif isinstance(event, LectureNoteRefinedSnapshot):
            self._metrics.refinements_completed_total += 1
        if state.refined and state.completion_acked:
            await self._deactivate(session_id, state)
        return True

    async def _save_checkpoint(self, session_id: str, state: _SessionState) -> None:
        await self._store.save(self._checkpoint(session_id, state))
        self._metrics.checkpoints_saved_total += 1

    def _checkpoint(
        self,
        session_id: str,
        state: _SessionState,
    ) -> LectureNoteSessionCheckpoint:
        accumulator = self._accumulator.export_session(session_id)
        if accumulator is None:
            raise ValueError("lecture note accumulator state is missing")
        return LectureNoteSessionCheckpoint(
            sessionId=session_id,
            lessonId=state.lesson_id,
            accumulator=accumulator,
            note=state.note,
            pending=state.pending.to_checkpoint() if state.pending else None,
            inFlight=state.in_flight.to_checkpoint() if state.in_flight else None,
            outbox=state.outbox,
            completed=state.completed,
            completionAcked=state.completion_acked,
            refinementPending=state.refinement_pending,
            refined=state.refined,
            updatedAt=datetime.now(UTC),
        )

    async def _deactivate(self, session_id: str, state: _SessionState) -> None:
        if state.deactivated:
            return
        await self._store.deactivate(session_id)
        state.deactivated = True
        self._sessions.pop(session_id, None)
        self._accumulator.remove_session(session_id)


class LectureNotePipeline:
    """caption 반영과 durable enqueue를 이어 consumer ACK 경계를 만든다."""

    def __init__(
        self,
        accumulator: LectureNoteWindowAccumulator,
        service: LectureNoteService,
    ) -> None:
        self._accumulator = accumulator
        self._service = service

    async def ingest(self, entry: CaptionEntry) -> tuple[LectureNoteWindow, ...]:
        result = self._accumulator.ingest(entry)
        if (
            self._accumulator.is_completed(entry.sessionId)
            and not result.windows
            and result.completion is None
        ):
            return result.windows
        await self._service.accept(
            entry.sessionId,
            entry.lessonId,
            result.windows,
            completion=result.completion,
        )
        return result.windows

    async def restore(self) -> None:
        await self._service.restore()

    async def after_ack(self, entry: CaptionEntry) -> None:
        if isinstance(entry, CaptionCompleted):
            await self._service.mark_completion_acked(entry.sessionId)

    async def after_owned_pending_drained(self) -> None:
        await self._service.reconcile_completion_acks_after_pending_drain()


def _restore_work(checkpoint: LectureNoteWorkCheckpoint | None) -> _PendingBatch | None:
    return None if checkpoint is None else _PendingBatch.from_checkpoint(checkpoint)


def _state_after_commit(
    state: _SessionState,
    event: LectureNoteEvent,
    *,
    refinement_enabled: bool,
) -> _SessionState:
    in_flight = state.in_flight
    completed = state.completed
    refinement_pending = state.refinement_pending
    refined = state.refined
    if isinstance(event, LectureNoteChunkAppended):
        if in_flight is not None:
            in_flight = _PendingBatch(
                operation_id=in_flight.operation_id,
                windows=[],
                completion=in_flight.completion,
            )
            if in_flight.completion is None:
                in_flight = None
    elif isinstance(event, LectureNoteCaptureCompleted):
        in_flight = None
        completed = True
        refinement_pending = bool(state.note.topics and refinement_enabled)
        refined = not refinement_pending
    else:
        refinement_pending = False
        refined = True
    return _SessionState(
        lesson_id=state.lesson_id,
        note=state.note,
        pending=state.pending,
        in_flight=in_flight,
        outbox=None,
        completed=completed,
        completion_acked=state.completion_acked,
        refinement_pending=refinement_pending,
        refined=refined,
    )


def _checkpoint_contains_event(
    checkpoint: LectureNoteSessionCheckpoint,
    event: LectureNoteEvent,
) -> bool:
    if checkpoint.outbox is not None:
        return False
    if isinstance(event, LectureNoteChunkAppended):
        return checkpoint.note.chunk_sequence == int(event.chunkSequence)
    if isinstance(event, LectureNoteCaptureCompleted):
        return checkpoint.completed and checkpoint.note.chunk_sequence == int(
            event.lastChunkSequence
        )
    return checkpoint.refined and checkpoint.note.chunk_sequence == int(
        event.sourceLastChunkSequence
    )


def _model_request(
    note: LectureNote,
    windows: list[LectureNoteWindow],
) -> LectureNoteModelRequest:
    current = note.topics[-1] if note.topics else None
    previous = note.topics[-2] if len(note.topics) >= 2 else None
    latest = windows[-1]
    return LectureNoteModelRequest(
        session_id=latest.session_id,
        lesson_id=latest.lesson_id,
        stt_session_id=latest.stt_session_id,
        current_topic_title=current.title if current is not None else None,
        current_key_points=current.key_points if current is not None else (),
        previous_topic_title=previous.title if previous is not None else None,
        previous_context=windows[0].previous_context,
        text="".join(window.text for window in windows),
    )


def _chunk_appended_event(
    previous: LectureNote,
    updated: LectureNote,
    window: LectureNoteWindow,
) -> LectureNoteChunkAppended:
    topic = updated.topics[-1]
    starts_new_topic = len(updated.topics) > len(previous.topics)
    topic_action = TopicAction.START_NEW if starts_new_topic else TopicAction.CONTINUE
    previous_points = set(previous.topics[-1].key_points) if previous.topics else set()
    key_points = (
        topic.key_points
        if starts_new_topic
        else tuple(point for point in topic.key_points if point not in previous_points)
    )
    return LectureNoteChunkAppended(
        eventId=f"evt-{uuid4().hex}",
        sessionId=window.session_id,
        lessonId=window.lesson_id,
        sttSessionId=window.stt_session_id,
        chunkSequence=str(updated.chunk_sequence),
        latestSttSequence=str(window.end_sequence),
        topicAction=topic_action,
        topicId=topic.topic_id,
        topicTitle=topic.title,
        keyPoints=key_points,
        markdownFragment=render_markdown_fragment(topic.title, key_points, topic_action),
        occurredAt=datetime.now(UTC),
    )


def _capture_completed_event(
    note: LectureNote,
    completion: CaptionCompleted,
) -> LectureNoteCaptureCompleted:
    return LectureNoteCaptureCompleted(
        eventId=f"evt-{uuid4().hex}",
        sessionId=completion.sessionId,
        lessonId=completion.lessonId,
        sttSessionId=completion.sttSessionId,
        lastChunkSequence=str(note.chunk_sequence),
        lastSttSequence=completion.lastSequence,
        reason=completion.reason,
        occurredAt=datetime.now(UTC),
    )


def _refined_snapshot_event(
    *,
    session_id: str,
    lesson_id: str,
    stt_session_id: str,
    note: LectureNote,
    result: LectureNoteRefinementResult,
) -> LectureNoteRefinedSnapshot:
    topics = tuple(
        LectureNoteRefinedTopic(
            topicId=f"refined-topic-{index}",
            topicTitle=topic.topicTitle,
            keyPoints=topic.keyPoints,
        )
        for index, topic in enumerate(result.topics, start=1)
    )
    return LectureNoteRefinedSnapshot(
        eventId=f"evt-{uuid4().hex}",
        sessionId=session_id,
        lessonId=lesson_id,
        sttSessionId=stt_session_id,
        sourceLastChunkSequence=str(note.chunk_sequence),
        topics=topics,
        markdownSnapshot=render_refined_markdown(topics),
        occurredAt=datetime.now(UTC),
    )
