from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.domain.errors import MaterialIngestionError

# Mirrors ai.annotation_highlight.text.
MAX_ANNOTATION_TEXT_CHARS = 2_000


class AnnotationIngestionError(MaterialIngestionError):
    """The annotation highlight could not be turned into indexable evidence."""


@dataclass(frozen=True, slots=True)
class AnnotationHighlight:
    """One highlight the instructor confirmed, on its way to the evidence index.

    Carries no image. Spring reads the crop with its own vision model and sends the resulting
    text (ADR-0074 결정 1), so the worker's job is embedding and storage — the description
    itself arrives already made and is indexed unverified.
    """

    highlight_id: UUID
    curriculum_id: UUID
    lesson_id: UUID
    session_id: UUID
    session_ms: int
    captured_at: datetime
    text: str

    def __post_init__(self) -> None:
        if self.session_ms < 0:
            raise AnnotationIngestionError("annotation session_ms must not be negative")
        if self.captured_at.tzinfo is None:
            raise AnnotationIngestionError("annotation captured_at must carry an offset")
        if not self.text.strip():
            raise AnnotationIngestionError("annotation text must not be blank")


@dataclass(frozen=True, slots=True)
class AnnotationRecord:
    """The row an indexed highlight becomes."""

    highlight_id: UUID
    curriculum_id: UUID
    lesson_id: UUID
    session_id: UUID
    session_ms: int
    captured_at: datetime
    text: str
    embedding: tuple[float, ...]
