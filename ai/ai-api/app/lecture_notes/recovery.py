from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.captions import CaptionCompleted
from app.lecture_notes.models import LectureNote, LectureNoteEvent, LectureNoteWindow


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
    pending: LectureNoteWorkCheckpoint | None = None
    inFlight: LectureNoteWorkCheckpoint | None = None
    outbox: LectureNoteEvent | None = None
    completed: bool = False
    completionAcked: bool = False
    updatedAt: datetime
