from __future__ import annotations

from typing import Protocol

from app.lecture_notes.models import (
    LectureNoteEvent,
    LectureNoteModelRequest,
    LectureNoteModelResult,
)


class LectureNoteModel(Protocol):
    async def generate(self, request: LectureNoteModelRequest) -> LectureNoteModelResult: ...


class LectureNoteEventPublisher(Protocol):
    async def publish(self, event: LectureNoteEvent) -> None: ...
