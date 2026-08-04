from __future__ import annotations

import logging

from app.domain import (
    BGE_M3_DIMENSIONS,
    MAX_ANNOTATION_TEXT_CHARS,
    AnnotationHighlight,
    AnnotationRecord,
    EmbeddingContractError,
)
from app.ports import AnnotationIndexStorage, TextEmbeddingModel

logger = logging.getLogger(__name__)


class IndexAnnotationHighlight:
    """Turn one confirmed highlight into timeline-anchored evidence (ADR-0074 결정 1).

    The description arrives already written: Spring reads the crop with its own vision model,
    the instructor confirms it, and the worker indexes that text as-is. There is deliberately
    no verification step here — ADR-0074 accepts that a wrong description gets indexed, and
    names the instructor confirmation on the Spring side as the only gate.
    """

    def __init__(
        self,
        embedding_model: TextEmbeddingModel,
        index_storage: AnnotationIndexStorage,
    ) -> None:
        self._embedding_model = embedding_model
        self._index_storage = index_storage

    async def execute(self, highlight: AnnotationHighlight) -> AnnotationRecord:
        self._validate_contract()
        text = highlight.text.strip()[:MAX_ANNOTATION_TEXT_CHARS]
        embedding = await self._embed(text)
        record = AnnotationRecord(
            highlight_id=highlight.highlight_id,
            curriculum_id=highlight.curriculum_id,
            lesson_id=highlight.lesson_id,
            session_id=highlight.session_id,
            session_ms=highlight.session_ms,
            captured_at=highlight.captured_at,
            text=text,
            embedding=embedding,
        )
        await self._index_storage.upsert(record)
        logger.info(
            "indexed annotation highlight",
            extra={
                "event": "annotation.indexed",
                "highlight_id": str(highlight.highlight_id),
                "session_ms": highlight.session_ms,
            },
        )
        return record

    async def _embed(self, text: str) -> tuple[float, ...]:
        raw = await self._embedding_model.embed((text,))
        try:
            vectors = tuple(raw)
        except TypeError as exc:
            raise EmbeddingContractError("embedding result must be an ordered sequence") from exc
        if len(vectors) != 1:
            raise EmbeddingContractError("embedding result count does not match input count")
        try:
            return tuple(float(value) for value in vectors[0])
        except (TypeError, ValueError, OverflowError) as exc:
            raise EmbeddingContractError("embedding result violates the storage contract") from exc

    def _validate_contract(self) -> None:
        if self._embedding_model.dimensions != BGE_M3_DIMENSIONS:
            raise EmbeddingContractError(
                f"embedding adapter must return {BGE_M3_DIMENSIONS} dimensions"
            )
