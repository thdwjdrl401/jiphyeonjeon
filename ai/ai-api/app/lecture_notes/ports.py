from __future__ import annotations

from typing import Protocol

from app.lecture_notes.models import (
    LectureNoteEvent,
    LectureNoteModelRequest,
    LectureNoteModelResult,
)
from app.lecture_notes.recovery import LectureNoteSessionCheckpoint


class LectureNoteModel(Protocol):
    async def generate(self, request: LectureNoteModelRequest) -> LectureNoteModelResult: ...


class LectureNoteStateStore(Protocol):
    async def save(self, checkpoint: LectureNoteSessionCheckpoint) -> None: ...

    async def commit(
        self,
        checkpoint: LectureNoteSessionCheckpoint,
        event: LectureNoteEvent,
    ) -> None: ...

    async def load_active(self) -> tuple[LectureNoteSessionCheckpoint, ...]: ...

    async def load(self, session_id: str) -> LectureNoteSessionCheckpoint | None: ...

    async def deactivate(self, session_id: str) -> None: ...
