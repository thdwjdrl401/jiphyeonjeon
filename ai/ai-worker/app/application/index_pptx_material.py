from __future__ import annotations

import asyncio
from collections.abc import Sequence

from app.domain import (
    BGE_M3_DIMENSIONS,
    ChunkRecord,
    EmbeddingContractError,
    EmptyPptxContentError,
    ExistingIndexVersion,
    MaterialIngestionError,
    StagedMaterial,
)
from app.ingestion import (
    DEFAULT_CHUNK_MAX_CHARS,
    MaterialChunk,
    PptxValidationLimits,
    chunk_presentation,
    chunk_strategy,
    parse_pptx,
)
from app.ports import IndexStorage, MaterialAssetStore, TextEmbeddingModel


class IndexPptxMaterial:
    """Build and atomically activate one transport-neutral material index version."""

    def __init__(
        self,
        asset_store: MaterialAssetStore,
        embedding_model: TextEmbeddingModel,
        index_storage: IndexStorage,
        *,
        validation_limits: PptxValidationLimits = PptxValidationLimits(),
        chunk_max_chars: int = DEFAULT_CHUNK_MAX_CHARS,
    ) -> None:
        self._asset_store = asset_store
        self._embedding_model = embedding_model
        self._index_storage = index_storage
        self._validation_limits = validation_limits
        self._chunk_max_chars = chunk_max_chars
        self._chunk_strategy = chunk_strategy(chunk_max_chars)

    async def execute(self, material: StagedMaterial) -> int:
        self._validate_contract(material)
        existing = await self._index_storage.find_existing(material)
        if existing is not None:
            if existing.activation_required:
                await self._index_storage.activate(material, existing.version_id)
            return existing.version_id

        source = await self._asset_store.read_pptx(
            material.source_bucket,
            material.source_object_key,
        )
        chunks = await asyncio.to_thread(
            _parse_and_chunk,
            source,
            self._validation_limits,
            self._chunk_max_chars,
        )
        if not chunks:
            raise EmptyPptxContentError("PPTX contains no supported indexable text")

        raw_embeddings = await self._embedding_model.embed(tuple(chunk.text for chunk in chunks))
        try:
            embeddings = tuple(raw_embeddings)
        except TypeError as exc:
            raise EmbeddingContractError("embedding result must be an ordered sequence") from exc
        if len(embeddings) != len(chunks):
            raise EmbeddingContractError("embedding result count does not match chunk count")

        records = _chunk_records(chunks, embeddings)
        version_id = await self._index_storage.stage(material, records)
        await self._index_storage.activate(material, version_id)
        return version_id

    async def find_existing(self, material: StagedMaterial) -> ExistingIndexVersion | None:
        """Return a resumable/completed DB result before source or GPU work."""

        self._validate_contract(material)
        return await self._index_storage.find_existing(material)

    def _validate_contract(self, material: StagedMaterial) -> None:
        if material.chunk_strategy != self._chunk_strategy:
            raise MaterialIngestionError(f"material chunk_strategy must be {self._chunk_strategy}")
        if (
            self._embedding_model.model_name != material.model_name
            or self._embedding_model.model_revision != material.model_revision
        ):
            raise EmbeddingContractError(
                "embedding adapter identity does not match the staged material"
            )
        if self._embedding_model.dimensions != BGE_M3_DIMENSIONS:
            raise EmbeddingContractError(
                f"embedding adapter must return {BGE_M3_DIMENSIONS} dimensions"
            )


def _parse_and_chunk(
    source: bytes,
    validation_limits: PptxValidationLimits,
    chunk_max_chars: int,
) -> tuple[MaterialChunk, ...]:
    presentation = parse_pptx(source, limits=validation_limits)
    return chunk_presentation(presentation, max_chars=chunk_max_chars)


def _chunk_records(
    chunks: tuple[MaterialChunk, ...],
    embeddings: tuple[Sequence[float], ...],
) -> tuple[ChunkRecord, ...]:
    try:
        return tuple(
            ChunkRecord(
                chunk_index=chunk.chunk_index,
                page=chunk.page,
                text=chunk.text,
                content_hash=chunk.content_hash,
                embedding=embedding,
            )
            for chunk, embedding in zip(chunks, embeddings, strict=True)
        )
    except (TypeError, ValueError, OverflowError) as exc:
        raise EmbeddingContractError("embedding result violates the storage contract") from exc
