from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
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
    KeyTerm,
    MaterialChunk,
    ParsedPresentation,
    PptxValidationLimits,
    chunk_presentation,
    chunk_strategy,
    parse_pptx,
)
from app.ports import IndexStorage, KeyTermExtractor, MaterialAssetStore, TextEmbeddingModel

logger = logging.getLogger(__name__)

_KEY_TERM_CACHE_MAX_ENTRIES = 1_000


@dataclass(frozen=True, slots=True)
class MaterialIndexResult:
    version_id: int
    key_terms: tuple[KeyTerm, ...] = field(default=())


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
        key_term_extractor: KeyTermExtractor | None = None,
    ) -> None:
        self._asset_store = asset_store
        self._embedding_model = embedding_model
        self._index_storage = index_storage
        self._validation_limits = validation_limits
        self._chunk_max_chars = chunk_max_chars
        self._chunk_strategy = chunk_strategy(chunk_max_chars)
        self._key_term_extractor = key_term_extractor
        # Best-effort retry safety net for the combined callback (ADR-0004 option C): if the
        # single terminal callback fails and the job redelivers, execute()'s idempotent
        # short-circuit below never re-extracts, so a same-process retry recovers key_terms
        # from here instead of silently dropping them. A process restart still loses it.
        self._key_term_cache: dict[str, tuple[KeyTerm, ...]] = {}

    async def execute(self, material: StagedMaterial) -> MaterialIndexResult:
        self._validate_contract(material)
        existing = await self._index_storage.find_existing(material)
        if existing is not None:
            if existing.activation_required:
                await self._index_storage.activate(material, existing.version_id)
            cached_key_terms = self._key_term_cache.get(material.job_id, ())
            return MaterialIndexResult(version_id=existing.version_id, key_terms=cached_key_terms)

        source = await self._asset_store.read_pptx(
            material.source_bucket,
            material.source_object_key,
        )
        presentation, chunks = await asyncio.to_thread(
            _parse_and_chunk,
            source,
            self._validation_limits,
            self._chunk_max_chars,
        )
        if not chunks:
            raise EmptyPptxContentError("PPTX contains no supported indexable text")

        if self._key_term_extractor is None:
            raw_embeddings = await self._embedding_model.embed(
                tuple(chunk.text for chunk in chunks)
            )
            key_terms: tuple[KeyTerm, ...] = ()
        else:
            raw_embeddings, key_terms = await asyncio.gather(
                self._embedding_model.embed(tuple(chunk.text for chunk in chunks)),
                _safe_extract_key_terms(self._key_term_extractor, presentation),
            )
        if key_terms:
            self._remember_key_terms(material.job_id, key_terms)
            logger.info(
                "extracted PPTX key terms",
                extra={
                    "event": "material.key_terms_extracted",
                    "material_id": str(material.material_id),
                    "key_term_count": len(key_terms),
                },
            )

        try:
            embeddings = tuple(raw_embeddings)
        except TypeError as exc:
            raise EmbeddingContractError("embedding result must be an ordered sequence") from exc
        if len(embeddings) != len(chunks):
            raise EmbeddingContractError("embedding result count does not match chunk count")

        records = _chunk_records(chunks, embeddings)
        version_id = await self._index_storage.stage(material, records)
        await self._index_storage.activate(material, version_id)
        return MaterialIndexResult(version_id=version_id, key_terms=key_terms)

    async def find_existing(self, material: StagedMaterial) -> ExistingIndexVersion | None:
        """Return a resumable/completed DB result before source or GPU work."""

        self._validate_contract(material)
        return await self._index_storage.find_existing(material)

    def _remember_key_terms(self, job_id: str, key_terms: tuple[KeyTerm, ...]) -> None:
        if (
            job_id not in self._key_term_cache
            and len(self._key_term_cache) >= _KEY_TERM_CACHE_MAX_ENTRIES
        ):
            oldest_job_id = next(iter(self._key_term_cache))
            del self._key_term_cache[oldest_job_id]
        self._key_term_cache[job_id] = key_terms

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
) -> tuple[ParsedPresentation, tuple[MaterialChunk, ...]]:
    presentation = parse_pptx(source, limits=validation_limits)
    chunks = chunk_presentation(presentation, max_chars=chunk_max_chars)
    return presentation, chunks


async def _safe_extract_key_terms(
    extractor: KeyTermExtractor,
    presentation: ParsedPresentation,
) -> tuple[KeyTerm, ...]:
    """Extraction is additive: any failure is logged and swallowed, never blocking indexing."""

    try:
        return tuple(await extractor.extract(_presentation_text(presentation)))
    except Exception:
        logger.warning(
            "PPTX key term extraction failed; continuing without key terms",
            extra={"event": "material.key_term_extraction_failed"},
            exc_info=True,
        )
        return ()


def _presentation_text(presentation: ParsedPresentation) -> str:
    lines: list[str] = []
    current_page: int | None = None
    for block in presentation.blocks:
        if block.page != current_page:
            lines.append(f"[슬라이드{block.page}]")
            current_page = block.page
        lines.append(block.text)
    return "\n".join(lines)


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
