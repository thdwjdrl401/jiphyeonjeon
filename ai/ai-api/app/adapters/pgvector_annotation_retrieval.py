from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.retrieval.models import AnnotationHighlightHit, SessionTimeCutoff
from app.retrieval.service import EMBEDDING_DIMENSIONS, MAX_ANNOTATION_WINDOW, MAX_TOP_K

_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# Same reciprocal-rank fusion as ACTIVE_MATERIAL_HYBRID_SQL so annotation and material hits
# carry comparable scores. Search scope is the asker's own session (ADR-0086 — narrowed from
# the curriculum-wide scope of ADR-0043 §4 after other sessions' highlights leaked into live
# answers); curriculum_id stays as defense-in-depth against a session row indexed under the
# wrong curriculum.
_CUTOFF_PREDICATE = """
    AND (
      CAST(:cutoff_session_id AS uuid) IS NULL
      OR session_id <> CAST(:cutoff_session_id AS uuid)
      OR session_ms <= :cutoff_max_session_ms
    )
"""

ANNOTATION_HYBRID_SQL = f"""
WITH scoped AS (
  SELECT
    highlight_id,
    curriculum_id,
    lesson_id,
    session_id,
    session_ms,
    text,
    search_vector,
    embedding
  FROM ai.annotation_highlight
  WHERE curriculum_id = CAST(:curriculum_id AS uuid)
    AND session_id = CAST(:session_id AS uuid)
    AND state = 'ACTIVE'
    {_CUTOFF_PREDICATE}
),
scored AS (
  SELECT
    highlight_id,
    curriculum_id,
    lesson_id,
    session_id,
    session_ms,
    text,
    GREATEST(0.0, 1.0 - (embedding <=> CAST(:query_embedding AS vector))) AS vector_score,
    ts_rank_cd(search_vector, plainto_tsquery('simple', :query_text), 32) AS lexical_score
  FROM scoped
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      ORDER BY vector_score DESC, session_id ASC, session_ms ASC, highlight_id ASC
    ) AS vector_rank,
    CASE
      WHEN lexical_score > 0 THEN ROW_NUMBER() OVER (
        ORDER BY CASE WHEN lexical_score > 0 THEN lexical_score END DESC NULLS LAST,
                 session_id ASC, session_ms ASC, highlight_id ASC
      )
    END AS lexical_rank
  FROM scored
)
SELECT
  highlight_id,
  curriculum_id,
  lesson_id,
  session_id,
  session_ms,
  text,
  vector_score,
  lexical_score,
  (
    1.0 / (60.0 + vector_rank)
    + CASE WHEN lexical_rank IS NULL THEN 0.0 ELSE 1.0 / (60.0 + lexical_rank) END
  ) / (2.0 / 61.0) AS score
FROM ranked
ORDER BY
  score DESC,
  vector_rank ASC,
  lexical_rank ASC NULLS LAST,
  session_id ASC,
  session_ms ASC,
  highlight_id ASC
LIMIT :top_k
"""

# Newest first, similarity deliberately absent: this is the "what did the instructor just
# highlight" read (ADR-0043 §5-1).
RECENT_ANNOTATION_SQL = f"""
SELECT
  highlight_id,
  curriculum_id,
  lesson_id,
  session_id,
  session_ms,
  text
FROM ai.annotation_highlight
WHERE session_id = CAST(:session_id AS uuid)
  AND state = 'ACTIVE'
  {_CUTOFF_PREDICATE}
ORDER BY session_ms DESC, highlight_id DESC
LIMIT :limit
"""


class PgvectorAnnotationRepository:
    """Search instructor highlight snapshots on the asker's session scope (ADR-0086)."""

    def __init__(self, engine: AsyncEngine, *, runtime_role: str = "ai_app") -> None:
        if not _DATABASE_ROLE.fullmatch(runtime_role):
            raise ValueError("runtime_role must be a safe PostgreSQL role identifier")
        self._engine = engine
        self._set_runtime_role = text(f"SET LOCAL ROLE {runtime_role}")

    async def search_annotations(
        self,
        *,
        curriculum_id: UUID,
        session_id: UUID,
        query_text: str,
        query_embedding: Sequence[float],
        top_k: int,
        cutoff: SessionTimeCutoff | None = None,
    ) -> tuple[AnnotationHighlightHit, ...]:
        if not isinstance(curriculum_id, UUID):
            raise TypeError("curriculum_id must be a UUID")
        if not isinstance(session_id, UUID):
            raise TypeError("session_id must be a UUID")
        normalized_query = query_text.strip()
        if not normalized_query:
            raise ValueError("query_text must contain non-whitespace text")
        if not 1 <= top_k <= MAX_TOP_K:
            raise ValueError(f"top_k must be between 1 and {MAX_TOP_K}")

        parameters: dict[str, object] = {
            "curriculum_id": str(curriculum_id),
            "session_id": str(session_id),
            "query_text": normalized_query,
            "query_embedding": _vector_literal(query_embedding),
            "top_k": top_k,
            **_cutoff_parameters(cutoff),
        }
        rows = await self._fetch(ANNOTATION_HYBRID_SQL, parameters)
        return tuple(_row_to_hit(row, scored=True) for row in rows)

    async def recent_annotations(
        self,
        *,
        session_id: UUID,
        limit: int,
        cutoff: SessionTimeCutoff | None = None,
    ) -> tuple[AnnotationHighlightHit, ...]:
        if not isinstance(session_id, UUID):
            raise TypeError("session_id must be a UUID")
        if not 1 <= limit <= MAX_ANNOTATION_WINDOW:
            raise ValueError(f"limit must be between 1 and {MAX_ANNOTATION_WINDOW}")

        parameters: dict[str, object] = {
            "session_id": str(session_id),
            "limit": limit,
            **_cutoff_parameters(cutoff),
        }
        rows = await self._fetch(RECENT_ANNOTATION_SQL, parameters)
        return tuple(_row_to_hit(row, scored=False) for row in rows)

    async def _fetch(
        self, statement: str, parameters: Mapping[str, object]
    ) -> Sequence[Mapping[str, Any]]:
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            result = await connection.execute(text(statement), dict(parameters))
            return result.mappings().all()


def _cutoff_parameters(cutoff: SessionTimeCutoff | None) -> dict[str, object]:
    if cutoff is None:
        return {"cutoff_session_id": None, "cutoff_max_session_ms": 0}
    if not isinstance(cutoff.session_id, UUID):
        raise TypeError("cutoff.session_id must be a UUID")
    if cutoff.max_session_ms < 0:
        raise ValueError("cutoff.max_session_ms must not be negative")
    return {
        "cutoff_session_id": str(cutoff.session_id),
        "cutoff_max_session_ms": cutoff.max_session_ms,
    }


def _row_to_hit(row: Mapping[str, Any], *, scored: bool) -> AnnotationHighlightHit:
    return AnnotationHighlightHit(
        highlight_id=_uuid_value(row["highlight_id"], "highlight_id"),
        curriculum_id=_uuid_value(row["curriculum_id"], "curriculum_id"),
        lesson_id=_uuid_value(row["lesson_id"], "lesson_id"),
        session_id=_uuid_value(row["session_id"], "session_id"),
        session_ms=int(row["session_ms"]),
        text=str(row["text"]),
        vector_score=float(row["vector_score"]) if scored else None,
        lexical_score=float(row["lexical_score"]) if scored else None,
        score=float(row["score"]) if scored else None,
    )


def _uuid_value(value: object, field_name: str) -> UUID:
    if isinstance(value, UUID):
        return value
    if isinstance(value, str):
        try:
            return UUID(value)
        except ValueError as exc:
            raise ValueError(f"database returned an invalid {field_name}") from exc
    raise ValueError(f"database returned a non-UUID {field_name}")


def _vector_literal(values: Sequence[float]) -> str:
    if len(values) != EMBEDDING_DIMENSIONS:
        raise ValueError(f"query embedding must contain exactly {EMBEDDING_DIMENSIONS} values")
    converted = tuple(float(value) for value in values)
    if any(not math.isfinite(value) for value in converted):
        raise ValueError("query embedding must contain only finite values")
    return "[" + ",".join(format(value, ".9g") for value in converted) + "]"
