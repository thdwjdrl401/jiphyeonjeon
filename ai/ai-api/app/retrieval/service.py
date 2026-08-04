from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from app.retrieval.models import AnnotationSnapshotHit, MaterialChunkHit, SessionTimeCutoff

EMBEDDING_DIMENSIONS = 1024
MAX_TOP_K = 50
MAX_ANNOTATION_WINDOW = 50


class QueryEmbeddingPort(Protocol):
    async def embed_query(self, text: str) -> Sequence[float]: ...


class ActiveMaterialSearchPort(Protocol):
    async def search_active(
        self,
        *,
        curriculum_id: UUID,
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
        curriculum_id: UUID,
        query_text: str,
        top_k: int = 5,
    ) -> tuple[MaterialChunkHit, ...]:
        if not isinstance(curriculum_id, UUID):
            raise TypeError("curriculum_id must be a UUID")
        normalized_query = query_text.strip()
        if not normalized_query:
            raise ValueError("query_text must contain non-whitespace text")
        if not 1 <= top_k <= MAX_TOP_K:
            raise ValueError(f"top_k must be between 1 and {MAX_TOP_K}")

        query_embedding = _normalize_embedding(await self._embedding.embed_query(normalized_query))
        return await self._repository.search_active(
            curriculum_id=curriculum_id,
            query_text=normalized_query,
            query_embedding=query_embedding,
            top_k=top_k,
        )


class AnnotationSearchPort(Protocol):
    async def search_annotations(
        self,
        *,
        curriculum_id: UUID,
        query_text: str,
        query_embedding: Sequence[float],
        top_k: int,
        cutoff: SessionTimeCutoff | None,
    ) -> tuple[AnnotationSnapshotHit, ...]: ...

    async def recent_annotations(
        self,
        *,
        session_id: UUID,
        limit: int,
        cutoff: SessionTimeCutoff | None,
    ) -> tuple[AnnotationSnapshotHit, ...]: ...


class AnnotationRetrievalService:
    """Two independent reads over the same index (ADR-0043 §5).

    `retrieve` answers "what did the instructor highlight about X" by similarity. `recent`
    answers "what did the instructor just highlight" by time, ignoring similarity entirely —
    a time deixis like "아까" has no meaning in embedding space, so no amount of semantic
    search finds it. Callers combine both and de-duplicate on snapshot_id.
    """

    def __init__(
        self,
        embedding: QueryEmbeddingPort,
        repository: AnnotationSearchPort,
    ) -> None:
        self._embedding = embedding
        self._repository = repository

    async def retrieve(
        self,
        *,
        curriculum_id: UUID,
        query_text: str,
        top_k: int = 2,
        cutoff: SessionTimeCutoff | None = None,
    ) -> tuple[AnnotationSnapshotHit, ...]:
        if not isinstance(curriculum_id, UUID):
            raise TypeError("curriculum_id must be a UUID")
        normalized_query = query_text.strip()
        if not normalized_query:
            raise ValueError("query_text must contain non-whitespace text")
        if not 1 <= top_k <= MAX_TOP_K:
            raise ValueError(f"top_k must be between 1 and {MAX_TOP_K}")

        query_embedding = _normalize_embedding(await self._embedding.embed_query(normalized_query))
        return await self._repository.search_annotations(
            curriculum_id=curriculum_id,
            query_text=normalized_query,
            query_embedding=query_embedding,
            top_k=top_k,
            cutoff=cutoff,
        )

    async def recent(
        self,
        *,
        session_id: UUID,
        limit: int = 5,
        cutoff: SessionTimeCutoff | None = None,
    ) -> tuple[AnnotationSnapshotHit, ...]:
        if not isinstance(session_id, UUID):
            raise TypeError("session_id must be a UUID")
        if not 1 <= limit <= MAX_ANNOTATION_WINDOW:
            raise ValueError(f"limit must be between 1 and {MAX_ANNOTATION_WINDOW}")

        return await self._repository.recent_annotations(
            session_id=session_id,
            limit=limit,
            cutoff=cutoff,
        )


def _normalize_embedding(values: Sequence[float]) -> tuple[float, ...]:
    if len(values) != EMBEDDING_DIMENSIONS:
        raise ValueError(f"query embedding must contain exactly {EMBEDDING_DIMENSIONS} values")
    normalized_values = tuple(float(value) for value in values)
    norm = math.sqrt(math.fsum(value * value for value in normalized_values))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError("query embedding must be finite and non-zero")
    return tuple(value / norm for value in normalized_values)
