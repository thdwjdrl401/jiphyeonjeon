from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from app.domain.errors import MaterialIngestionError

AnnotationTextOrigin = Literal["SPRING", "MODEL"]

# Mirrors ai.annotation_snapshot.text (ADR-0043 §1).
MAX_ANNOTATION_TEXT_CHARS = 2_000


class AnnotationIngestionError(MaterialIngestionError):
    """The annotation snapshot could not be turned into indexable evidence."""


@dataclass(frozen=True, slots=True)
class AnnotationSnapshot:
    """One highlight the instructor confirmed, on its way to the evidence index.

    Carries no image: the worker fetches that at processing time from `asset_id` so a job that
    waits in the queue or retries never holds an expired URL (ADR-0043 §2).
    """

    snapshot_id: UUID
    asset_id: UUID
    curriculum_id: UUID
    lesson_id: UUID
    session_id: UUID
    session_ms: int
    captured_at: datetime
    interpreted_text: str | None

    def __post_init__(self) -> None:
        if self.session_ms < 0:
            raise AnnotationIngestionError("annotation session_ms must not be negative")
        if self.captured_at.tzinfo is None:
            raise AnnotationIngestionError("annotation captured_at must carry an offset")


@dataclass(frozen=True, slots=True)
class AnnotationRecord:
    """The row an indexed snapshot becomes."""

    snapshot_id: UUID
    asset_id: UUID
    curriculum_id: UUID
    lesson_id: UUID
    session_id: UUID
    session_ms: int
    captured_at: datetime
    text: str
    text_origin: AnnotationTextOrigin
    embedding: tuple[float, ...]
