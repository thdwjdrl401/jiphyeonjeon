from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.captions import CaptionCompleted
from app.lecture_notes.models import (
    LectureNote,
    LectureNoteDraft,
    LectureNoteEvent,
    LectureNoteWindow,
)


class _CheckpointModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AttemptBufferCheckpoint(_CheckpointModel):
    sttSessionId: str
    lastSequence: int = 0
    lastStreamElapsedMs: int = 0
    windowStartedAtMs: int = 0
    windowStartSequence: int | None = None
    partialText: str = ""


class WindowAccumulatorCheckpoint(_CheckpointModel):
    sessionId: str
    lessonId: str
    current: AttemptBufferCheckpoint
    retiredAttempts: tuple[str, ...] = ()
    previousContext: str = ""
    completed: bool = False
    seenEventIds: tuple[str, ...] = ()


class LectureNoteWorkCheckpoint(_CheckpointModel):
    operationId: str
    windows: tuple[LectureNoteWindow, ...] = ()
    completion: CaptionCompleted | None = None


class LectureNoteSessionCheckpoint(_CheckpointModel):
    checkpointVersion: Literal["1"] = "1"
    sessionId: str
    lessonId: str
    accumulator: WindowAccumulatorCheckpoint
    note: LectureNote = LectureNote()
    # version 1의 optional 필드로 추가해 구 JSON은 기본값으로 읽고 service에서 승격한다.
    draft: LectureNoteDraft = LectureNoteDraft()
    pending: LectureNoteWorkCheckpoint | None = None
    inFlight: LectureNoteWorkCheckpoint | None = None
    outbox: LectureNoteEvent | None = None
    completed: bool = False
    completionAcked: bool = False
    refinementPending: bool = False
    # 구 checkpoint는 refined 단계 도입 전 완료본이므로 migration 시 다시 정제하지 않는다.
    refined: bool = True
    updatedAt: datetime
