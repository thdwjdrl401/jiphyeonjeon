from __future__ import annotations

import math
import re
from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.domain import BGE_M3_DIMENSIONS, AnnotationIngestionError, AnnotationRecord

_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# highlight_id is the idempotency key (ADR-0074): a re-published job replaces the row rather
# than adding a second copy of the same highlight. Re-indexing also revives a DELETED row,
# which is what "the instructor put it back" should mean.
_UPSERT_SQL = """
INSERT INTO ai.annotation_highlight (
  highlight_id, curriculum_id, lesson_id, session_id,
  session_ms, captured_at, text, embedding, state
) VALUES (
  CAST(:highlight_id AS uuid), CAST(:curriculum_id AS uuid),
  CAST(:lesson_id AS uuid), CAST(:session_id AS uuid), :session_ms, :captured_at,
  :text, CAST(:embedding AS vector), 'ACTIVE'
)
ON CONFLICT (highlight_id) DO UPDATE SET
  curriculum_id = EXCLUDED.curriculum_id,
  lesson_id = EXCLUDED.lesson_id,
  session_id = EXCLUDED.session_id,
  session_ms = EXCLUDED.session_ms,
  captured_at = EXCLUDED.captured_at,
  text = EXCLUDED.text,
  embedding = EXCLUDED.embedding,
  state = 'ACTIVE',
  updated_at = now()
"""

# Soft delete: the row stays so a repeated delete stays cheap and an operator can still see
# what was withdrawn.
_DELETE_SQL = """
UPDATE ai.annotation_highlight
SET state = 'DELETED', updated_at = now()
WHERE highlight_id = CAST(:highlight_id AS uuid) AND state <> 'DELETED'
"""


class PgvectorAnnotationIndexRepository:
    """Persist one highlight snapshot as searchable evidence (ADR-0043 §1)."""

    def __init__(self, engine: AsyncEngine, *, runtime_role: str = "ai_app") -> None:
        if not _DATABASE_ROLE.fullmatch(runtime_role):
            raise ValueError("runtime_role must be a safe PostgreSQL role identifier")
        self._engine = engine
        self._set_runtime_role = text(f"SET LOCAL ROLE {runtime_role}")

    async def upsert(self, record: AnnotationRecord) -> None:
        parameters = {
            "highlight_id": str(record.highlight_id),
            "curriculum_id": str(record.curriculum_id),
            "lesson_id": str(record.lesson_id),
            "session_id": str(record.session_id),
            "session_ms": record.session_ms,
            "captured_at": record.captured_at,
            "text": record.text,
            "embedding": _vector_literal(record.embedding),
        }
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            await connection.execute(text(_UPSERT_SQL), parameters)

    async def mark_deleted(self, highlight_id: UUID) -> None:
        if not isinstance(highlight_id, UUID):
            raise AnnotationIngestionError("annotation highlight_id must be a UUID")
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            await connection.execute(text(_DELETE_SQL), {"highlight_id": str(highlight_id)})


def _vector_literal(values: Sequence[float]) -> str:
    if len(values) != BGE_M3_DIMENSIONS:
        raise AnnotationIngestionError(
            f"annotation embedding must contain exactly {BGE_M3_DIMENSIONS} values"
        )
    converted = tuple(float(value) for value in values)
    if any(not math.isfinite(value) for value in converted):
        raise AnnotationIngestionError("annotation embedding must contain only finite values")
    if not any(converted):
        raise AnnotationIngestionError("annotation embedding must not be the zero vector")
    return "[" + ",".join(format(value, ".9g") for value in converted) + "]"
