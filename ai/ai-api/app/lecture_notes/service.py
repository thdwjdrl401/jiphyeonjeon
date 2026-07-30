from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from uuid import uuid4

from app.captions import CaptionCompleted, CaptionEntry
from app.lecture_notes.models import (
    LectureNote,
    LectureNoteModelRequest,
    LectureNoteSnapshot,
    LectureNoteSnapshotTopic,
    LectureNoteStatus,
    LectureNoteWindow,
)
from app.lecture_notes.ports import LectureNoteModel, LectureNoteSnapshotStore
from app.lecture_notes.reducer import apply_model_result, render_markdown
from app.lecture_notes.windowing import LectureNoteWindowAccumulator

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LectureNoteServiceMetrics:
    windows_enqueued_total: int = 0
    windows_coalesced_total: int = 0
    model_calls_total: int = 0
    model_failures_total: int = 0
    snapshots_saved_total: int = 0
    snapshot_failures_total: int = 0
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
        store: LectureNoteSnapshotStore,
    ) -> None:
        self._model = model
        self._store = store
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
            "snapshots_saved_total": self._metrics.snapshots_saved_total,
            "snapshot_failures_total": self._metrics.snapshot_failures_total,
            "completed_total": self._metrics.completed_total,
            "tracked_sessions": len(self._sessions),
            "running_tasks": len(self._tasks),
        }

    async def _drain_session(self, session_id: str, state: _SessionState) -> None:
        try:
            while state.pending is not None:
                batch = state.pending
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
            note = apply_model_result(note, result)
        elif batch.completion is not None:
            note = replace(note, note_version=note.note_version + 1)
        else:
            return

        scope = batch.windows[-1] if batch.windows else batch.completion
        if scope is None:  # pragma: no cover - guarded above
            return
        completed = batch.completion is not None
        snapshot = _snapshot(note, scope, completed=completed)
        try:
            await self._store.save(snapshot)
        except Exception as exc:
            self._metrics.snapshot_failures_total += 1
            logger.warning(
                "강의 노트 snapshot 저장 실패",
                extra={
                    "event": "lecture_note.snapshot_failed",
                    "session_id": session_id,
                    "error_code": type(exc).__name__,
                },
            )
            return
        state.note = note
        self._metrics.snapshots_saved_total += 1
        if completed:
            state.completed = True
            self._metrics.completed_total += 1


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
        windows = self._accumulator.ingest(entry)
        completion = entry if isinstance(entry, CaptionCompleted) else None
        self._service.enqueue(windows, completion=completion)
        return windows


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


def _snapshot(
    note: LectureNote,
    scope: LectureNoteWindow | CaptionCompleted,
    *,
    completed: bool,
) -> LectureNoteSnapshot:
    if isinstance(scope, LectureNoteWindow):
        session_id = scope.session_id
        lesson_id = scope.lesson_id
        stt_session_id = scope.stt_session_id
        covered_sequence = scope.end_sequence
    else:
        session_id = scope.sessionId
        lesson_id = scope.lessonId
        stt_session_id = scope.sttSessionId
        covered_sequence = int(scope.lastSequence)
    return LectureNoteSnapshot(
        eventId=f"evt-{uuid4().hex}",
        sessionId=session_id,
        lessonId=lesson_id,
        sttSessionId=stt_session_id,
        noteVersion=str(note.note_version),
        coveredThroughSequence=str(covered_sequence),
        status=LectureNoteStatus.COMPLETED if completed else LectureNoteStatus.PROCESSING,
        topics=tuple(
            LectureNoteSnapshotTopic(
                topicId=topic.topic_id,
                title=topic.title,
                keyPoints=topic.key_points,
            )
            for topic in note.topics
        ),
        markdown=render_markdown(note),
        occurredAt=datetime.now(UTC),
    )
