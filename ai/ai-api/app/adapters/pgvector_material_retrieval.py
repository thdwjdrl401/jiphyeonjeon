from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.retrieval.models import MaterialChunkHit
from app.retrieval.service import EMBEDDING_DIMENSIONS, MAX_TOP_K

_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

ACTIVE_MATERIAL_HYBRID_SQL = """
WITH scoped AS (
  SELECT
    dc.id AS chunk_id,
    mv.id AS material_version_id,
    mv.lesson_id,
    mv.material_id,
    mv.material_version,
    dc.page,
    dc.chunk_index,
    dc.text,
    dc.search_vector,
    ce.embedding
  FROM ai.material_version mv
  JOIN ai.document_chunk dc ON dc.material_version_id = mv.id
  JOIN ai.chunk_embedding ce ON ce.chunk_id = dc.id
  WHERE mv.lesson_id = CAST(:lesson_id AS uuid)
    AND mv.state = 'ACTIVE'
),
scored AS (
  SELECT
    chunk_id,
    material_version_id,
    lesson_id,
    material_id,
    material_version,
    page,
    chunk_index,
    text,
    GREATEST(0.0, 1.0 - (embedding <=> CAST(:query_embedding AS vector))) AS vector_score,
    ts_rank_cd(search_vector, plainto_tsquery('simple', :query_text), 32) AS lexical_score
  FROM scoped
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      ORDER BY vector_score DESC, material_id ASC, material_version_id ASC,
               page ASC, chunk_index ASC, chunk_id ASC
    ) AS vector_rank,
    CASE
      WHEN lexical_score > 0 THEN ROW_NUMBER() OVER (
        ORDER BY CASE WHEN lexical_score > 0 THEN lexical_score END DESC NULLS LAST,
                 material_id ASC, material_version_id ASC, page ASC,
                 chunk_index ASC, chunk_id ASC
      )
    END AS lexical_rank
  FROM scored
)
SELECT
  chunk_id,
  material_version_id,
  lesson_id,
  material_id,
  material_version,
  page,
  chunk_index,
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
  material_id ASC,
  material_version_id ASC,
  page ASC,
  chunk_index ASC,
  chunk_id ASC
LIMIT :top_k
"""


class PgvectorActiveMaterialRepository:
    """Search active material versions in exactly one UUID lesson scope."""

    def __init__(self, engine: AsyncEngine, *, runtime_role: str = "ai_app") -> None:
        if not _DATABASE_ROLE.fullmatch(runtime_role):
            raise ValueError("runtime_role must be a safe PostgreSQL role identifier")
        self._engine = engine
        self._set_runtime_role = text(f"SET LOCAL ROLE {runtime_role}")

    async def search_active(
        self,
        *,
        lesson_id: UUID,
        query_text: str,
        query_embedding: Sequence[float],
        top_k: int,
    ) -> tuple[MaterialChunkHit, ...]:
        if not isinstance(lesson_id, UUID):
            raise TypeError("lesson_id must be a UUID")
        normalized_query = query_text.strip()
        if not normalized_query:
            raise ValueError("query_text must contain non-whitespace text")
        if not 1 <= top_k <= MAX_TOP_K:
            raise ValueError(f"top_k must be between 1 and {MAX_TOP_K}")

        parameters: dict[str, object] = {
            "lesson_id": str(lesson_id),
            "query_text": normalized_query,
            "query_embedding": _vector_literal(query_embedding),
            "top_k": top_k,
        }
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            result = await connection.execute(text(ACTIVE_MATERIAL_HYBRID_SQL), parameters)
            rows = result.mappings().all()
        return tuple(_row_to_hit(row) for row in rows)


def _row_to_hit(row: Mapping[str, Any]) -> MaterialChunkHit:
    return MaterialChunkHit(
        chunk_id=int(row["chunk_id"]),
        material_version_id=int(row["material_version_id"]),
        lesson_id=_uuid_value(row["lesson_id"], "lesson_id"),
        material_id=_uuid_value(row["material_id"], "material_id"),
        material_version=int(row["material_version"]),
        page=int(row["page"]),
        chunk_index=int(row["chunk_index"]),
        text=str(row["text"]),
        vector_score=float(row["vector_score"]),
        lexical_score=float(row["lexical_score"]),
        score=float(row["score"]),
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
