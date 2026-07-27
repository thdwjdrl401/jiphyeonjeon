from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from app.retrieval.models import MaterialChunkHit

EMBEDDING_DIMENSIONS = 1024
MAX_TOP_K = 50


class QueryEmbeddingPort(Protocol):
    async def embed_query(self, text: str) -> Sequence[float]: ...


class ActiveMaterialSearchPort(Protocol):
    async def search_active(
        self,
        *,
        lesson_id: UUID,
        query_text: str,
        query_embedding: Sequence[float],
        top_k: int,
    ) -> tuple[MaterialChunkHit, ...]: ...


class ActiveMaterialRetrievalService:
    def __init__(
        self,
        embedding: QueryEmbeddingPort,
        repository: ActiveMaterialSearchPort,
    ) -> None:
        self._embedding = embedding
        self._repository = repository

    async def retrieve(
        self,
        *,
        lesson_id: UUID,
        query_text: str,
        top_k: int = 5,
    ) -> tuple[MaterialChunkHit, ...]:
        if not isinstance(lesson_id, UUID):
            raise TypeError("lesson_id must be a UUID")
        normalized_query = query_text.strip()
        if not normalized_query:
            raise ValueError("query_text must contain non-whitespace text")
        if not 1 <= top_k <= MAX_TOP_K:
            raise ValueError(f"top_k must be between 1 and {MAX_TOP_K}")

        query_embedding = _normalize_embedding(await self._embedding.embed_query(normalized_query))
        return await self._repository.search_active(
            lesson_id=lesson_id,
            query_text=normalized_query,
            query_embedding=query_embedding,
            top_k=top_k,
        )


def _normalize_embedding(values: Sequence[float]) -> tuple[float, ...]:
    if len(values) != EMBEDDING_DIMENSIONS:
        raise ValueError(f"query embedding must contain exactly {EMBEDDING_DIMENSIONS} values")
    normalized_values = tuple(float(value) for value in values)
    norm = math.sqrt(math.fsum(value * value for value in normalized_values))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError("query embedding must be finite and non-zero")
    return tuple(value / norm for value in normalized_values)
