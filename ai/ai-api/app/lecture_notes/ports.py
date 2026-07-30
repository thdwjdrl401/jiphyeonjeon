from __future__ import annotations

from typing import Protocol

from app.lecture_notes.models import (
    LectureNoteModelRequest,
    LectureNoteModelResult,
    LectureNoteSnapshot,
)


class LectureNoteModel(Protocol):
    async def generate(self, request: LectureNoteModelRequest) -> LectureNoteModelResult: ...


class LectureNoteSnapshotStore(Protocol):
    async def save(self, snapshot: LectureNoteSnapshot) -> None: ...
