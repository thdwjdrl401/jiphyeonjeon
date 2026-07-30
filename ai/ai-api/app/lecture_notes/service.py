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
    LectureNoteWindow,
    TopicAction,
)
from app.lecture_notes.ports import LectureNoteEventPublisher, LectureNoteModel
from app.lecture_notes.reducer import apply_model_result, render_markdown_fragment
from app.lecture_notes.windowing import LectureNoteWindowAccumulator

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LectureNoteServiceMetrics:
    windows_enqueued_total: int = 0
    windows_coalesced_total: int = 0
    model_calls_total: int = 0
    model_failures_total: int = 0
    events_published_total: int = 0
    publish_failures_total: int = 0
    completed_total: int = 0


@dataclass(slots=True)
class _PendingBatch:
    windows: list[LectureNoteWindow] = field(default_factory=list)
    completion: CaptionCompleted | None = None


@dataclass(slots=True)
class _SessionState:
    lesson_id: str
    note: LectureNote = field(default_factory=LectureNote)
    pending: _PendingBatch | None = None
    task: asyncio.Task[None] | None = None
    completed: bool = False


class LectureNoteService:
    """세션별 모델 호출 하나와 대기 batch 하나만 유지한다."""

    def __init__(
        self,
        model: LectureNoteModel,
        publisher: LectureNoteEventPublisher,
    ) -> None:
        self._model = model
        self._publisher = publisher
        self._sessions: dict[str, _SessionState] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._metrics = LectureNoteServiceMetrics()
        self._closed = False

    def enqueue(
        self,
        windows: tuple[LectureNoteWindow, ...],
        *,
        completion: CaptionCompleted | None = None,
    ) -> None:
        if self._closed:
            raise RuntimeError("lecture note service is closed")
        if not windows and completion is None:
            return
        session_id, lesson_id = _scope(windows, completion)
        state = self._sessions.get(session_id)
        if state is None:
            state = _SessionState(lesson_id=lesson_id)
            self._sessions[session_id] = state
        elif state.lesson_id != lesson_id:
            raise ValueError("lecture note session cannot change lesson scope")
        if state.completed:
            return

        if state.pending is None:
            state.pending = _PendingBatch()
        elif windows:
            self._metrics.windows_coalesced_total += len(windows)
        state.pending.windows.extend(windows)
        state.pending.completion = completion or state.pending.completion
        self._metrics.windows_enqueued_total += len(windows)

        if state.task is None:
            task = asyncio.create_task(
                self._drain_session(session_id, state),
                name=f"lecture-note:{session_id}",
            )
            state.task = task
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

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
            "events_published_total": self._metrics.events_published_total,
            "publish_failures_total": self._metrics.publish_failures_total,
            "completed_total": self._metrics.completed_total,
            "tracked_sessions": len(self._sessions),
            "running_tasks": len(self._tasks),
        }

    async def _drain_session(self, session_id: str, state: _SessionState) -> None:
        try:
            while state.pending is not None:
                batch = state.pending
                # 호출 전에 비워야 호출 중 들어온 window가 다음 batch 하나로만 합쳐진다.
                state.pending = None
                await self._process_batch(session_id, state, batch)
        finally:
            state.task = None
            if state.completed:
                self._sessions.pop(session_id, None)

    async def _process_batch(
        self,
        session_id: str,
        state: _SessionState,
        batch: _PendingBatch,
    ) -> None:
        note = state.note
        if batch.windows:
            request = _model_request(note, batch.windows)
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
                return
            updated_note = apply_model_result(note, result)
            if updated_note != note:
                event = _chunk_appended_event(note, updated_note, batch.windows[-1])
                if not await self._publish(event, session_id):
                    return
                note = updated_note
                state.note = note

        if batch.completion is None:
            return
        event = _capture_completed_event(note, batch.completion)
        if not await self._publish(event, session_id):
            return
        state.completed = True
        self._metrics.completed_total += 1

    async def _publish(self, event: LectureNoteEvent, session_id: str) -> bool:
        try:
            await self._publisher.publish(event)
        except Exception as exc:
            self._metrics.publish_failures_total += 1
            logger.warning(
                "강의 노트 event 발행 실패",
                extra={
                    "event": "lecture_note.publish_failed",
                    "session_id": session_id,
                    "note_event_type": event.type,
                    "error_code": type(exc).__name__,
                },
            )
            return False
        self._metrics.events_published_total += 1
        return True


class LectureNotePipeline:
    """caption entry 반영과 비동기 모델 작업 enqueue를 잇는 동기 handler다."""

    def __init__(
        self,
        accumulator: LectureNoteWindowAccumulator,
        service: LectureNoteService,
    ) -> None:
        self._accumulator = accumulator
        self._service = service

    def ingest(self, entry: CaptionEntry) -> tuple[LectureNoteWindow, ...]:
        result = self._accumulator.ingest(entry)
        self._service.enqueue(result.windows, completion=result.completion)
        return result.windows


def _scope(
    windows: tuple[LectureNoteWindow, ...],
    completion: CaptionCompleted | None,
) -> tuple[str, str]:
    if windows:
        return windows[-1].session_id, windows[-1].lesson_id
    if completion is None:  # pragma: no cover - enqueue guards this
        raise ValueError("lecture note work requires a scope")
    return completion.sessionId, completion.lessonId


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
