from __future__ import annotations

import logging

from app.domain import (
    BGE_M3_DIMENSIONS,
    MAX_ANNOTATION_TEXT_CHARS,
    AnnotationIngestionError,
    AnnotationRecord,
    AnnotationSnapshot,
    AnnotationTextOrigin,
    EmbeddingContractError,
)
from app.ports import (
    AnnotationImageStore,
    AnnotationIndexStorage,
    AnnotationReader,
    TextEmbeddingModel,
)

logger = logging.getLogger(__name__)


class IndexAnnotationSnapshot:
    """Turn one confirmed highlight into timeline-anchored evidence (ADR-0043 §2-3).

    Text comes from Spring when Spring has it. Only an uninterpreted snapshot is read by a
    model — re-reading one Spring already interpreted would split what the instructor sees on
    screen from what the answer cites back.

    Unlike PPTX key term extraction, a reading failure is terminal: the text *is* the artifact,
    so there is no "continue without it" path that would leave a snapshot indexed as blank.
    """

    def __init__(
        self,
        image_store: AnnotationImageStore,
        embedding_model: TextEmbeddingModel,
        index_storage: AnnotationIndexStorage,
        *,
        reader: AnnotationReader | None = None,
    ) -> None:
        self._image_store = image_store
        self._embedding_model = embedding_model
        self._index_storage = index_storage
        self._reader = reader

    async def execute(self, snapshot: AnnotationSnapshot) -> AnnotationRecord:
        self._validate_contract()
        text, origin = await self._resolve_text(snapshot)
        embedding = await self._embed(text)
        record = AnnotationRecord(
            snapshot_id=snapshot.snapshot_id,
            asset_id=snapshot.asset_id,
            curriculum_id=snapshot.curriculum_id,
            lesson_id=snapshot.lesson_id,
            session_id=snapshot.session_id,
            session_ms=snapshot.session_ms,
            captured_at=snapshot.captured_at,
            text=text,
            text_origin=origin,
            embedding=embedding,
        )
        await self._index_storage.upsert(record)
        logger.info(
            "indexed annotation snapshot",
            extra={
                "event": "annotation.indexed",
                "snapshot_id": str(snapshot.snapshot_id),
                "session_ms": snapshot.session_ms,
                "text_origin": origin,
            },
        )
        return record

    async def _resolve_text(self, snapshot: AnnotationSnapshot) -> tuple[str, AnnotationTextOrigin]:
        provided = (snapshot.interpreted_text or "").strip()
        if provided:
            return provided[:MAX_ANNOTATION_TEXT_CHARS], "SPRING"
        if self._reader is None:
            raise AnnotationIngestionError(
                "annotation snapshot has no interpretedText and no reader is configured"
            )
        image = await self._image_store.read_annotation_image(snapshot.asset_id)
        text = (await self._reader.read(image)).strip()
        if not text:
            raise AnnotationIngestionError("annotation image produced no text")
        return text[:MAX_ANNOTATION_TEXT_CHARS], "MODEL"

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
