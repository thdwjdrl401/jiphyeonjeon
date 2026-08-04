from __future__ import annotations

import math
import re
from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.domain import BGE_M3_DIMENSIONS, AnnotationIngestionError, AnnotationRecord

_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# snapshot_id is the idempotency key (ADR-0043 §2): a re-published job replaces the row rather
# than adding a second copy of the same highlight. Re-indexing also revives a DELETED row,
# which is what "the instructor put it back" should mean.
_UPSERT_SQL = """
INSERT INTO ai.annotation_snapshot (
  snapshot_id, asset_id, curriculum_id, lesson_id, session_id,
  session_ms, captured_at, text, text_origin, embedding, state
) VALUES (
  CAST(:snapshot_id AS uuid), CAST(:asset_id AS uuid), CAST(:curriculum_id AS uuid),
  CAST(:lesson_id AS uuid), CAST(:session_id AS uuid), :session_ms, :captured_at,
  :text, :text_origin, CAST(:embedding AS vector), 'ACTIVE'
)
ON CONFLICT (snapshot_id) DO UPDATE SET
  asset_id = EXCLUDED.asset_id,
  curriculum_id = EXCLUDED.curriculum_id,
  lesson_id = EXCLUDED.lesson_id,
  session_id = EXCLUDED.session_id,
  session_ms = EXCLUDED.session_ms,
  captured_at = EXCLUDED.captured_at,
  text = EXCLUDED.text,
  text_origin = EXCLUDED.text_origin,
  embedding = EXCLUDED.embedding,
  state = 'ACTIVE',
  updated_at = now()
"""

# Soft delete: the row stays so a repeated delete stays cheap and an operator can still see
# what was withdrawn (ADR-0043 §1).
_DELETE_SQL = """
UPDATE ai.annotation_snapshot
SET state = 'DELETED', updated_at = now()
WHERE snapshot_id = CAST(:snapshot_id AS uuid) AND state <> 'DELETED'
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
            "snapshot_id": str(record.snapshot_id),
            "asset_id": str(record.asset_id),
            "curriculum_id": str(record.curriculum_id),
            "lesson_id": str(record.lesson_id),
            "session_id": str(record.session_id),
            "session_ms": record.session_ms,
            "captured_at": record.captured_at,
            "text": record.text,
            "text_origin": record.text_origin,
            "embedding": _vector_literal(record.embedding),
        }
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            await connection.execute(text(_UPSERT_SQL), parameters)

    async def mark_deleted(self, snapshot_id: UUID) -> None:
        if not isinstance(snapshot_id, UUID):
            raise AnnotationIngestionError("annotation snapshot_id must be a UUID")
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            await connection.execute(text(_DELETE_SQL), {"snapshot_id": str(snapshot_id)})


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
