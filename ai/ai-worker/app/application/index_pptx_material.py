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
    KeyTermExtractionResult,
    MaterialChunk,
    ParsedPresentation,
    PptxValidationLimits,
    chunk_presentation,
    chunk_strategy,
    parse_pptx,
)
from app.ports import (
    IndexStorage,
    KeyTermExtractor,
    KeyTermStorage,
    MaterialAssetStore,
    TextEmbeddingModel,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class MaterialIndexResult:
    version_id: int
    key_term_result: KeyTermExtractionResult = field(
        default_factory=lambda: KeyTermExtractionResult(status="NOT_REQUESTED")
    )
    chunk_count: int | None = None

    @property
    def key_terms(self) -> tuple[KeyTerm, ...]:
        """Compatibility view for the existing combined callback contract."""

        return self.key_term_result.terms


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
        key_term_storage: KeyTermStorage | None = None,
    ) -> None:
        self._asset_store = asset_store
        self._embedding_model = embedding_model
        self._index_storage = index_storage
        self._validation_limits = validation_limits
        self._chunk_max_chars = chunk_max_chars
        self._chunk_strategy = chunk_strategy(chunk_max_chars)
        self._key_term_extractor = key_term_extractor
        self._key_term_storage = key_term_storage

    async def execute(
        self,
        material: StagedMaterial,
        *,
        extract_key_terms: bool | None = None,
    ) -> MaterialIndexResult:
        self._validate_contract(material)
        requested = (
            self._key_term_extractor is not None if extract_key_terms is None else extract_key_terms
        )
        existing = await self._index_storage.find_existing(material)
        if existing is not None:
            stored_result = await self._load_key_term_result(existing.version_id)
            needs_key_term_resume = requested and (
                stored_result is None or stored_result.status in {"NOT_REQUESTED", "PENDING"}
            )
            if needs_key_term_resume:
                presentation, _ = await self._read_parse_and_chunk(material)
                key_term_result = await self._extract_key_terms(presentation, requested=True)
                key_term_result = await self._persist_key_term_result(
                    existing.version_id, key_term_result
                )
            else:
                key_term_result = stored_result or KeyTermExtractionResult(status="NOT_REQUESTED")
            if existing.activation_required:
                await self._index_storage.activate(material, existing.version_id)
            return MaterialIndexResult(
                version_id=existing.version_id,
                key_term_result=key_term_result,
            )

        presentation, chunks = await self._read_parse_and_chunk(material)
        if not chunks:
            raise EmptyPptxContentError("PPTX contains no supported indexable text")

        if not requested:
            raw_embeddings = await self._embedding_model.embed(
                tuple(chunk.text for chunk in chunks)
            )
            key_term_result = KeyTermExtractionResult(status="NOT_REQUESTED")
        else:
            raw_embeddings, key_term_result = await asyncio.gather(
                self._embedding_model.embed(tuple(chunk.text for chunk in chunks)),
                self._extract_key_terms(presentation, requested=True),
            )
        if key_term_result.status == "READY":
            logger.info(
                "extracted PPTX key terms",
                extra={
                    "event": "material.key_terms_extracted",
                    "material_id": str(material.material_id),
                    "key_term_count": key_term_result.count,
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
        key_term_result = await self._persist_key_term_result(version_id, key_term_result)
        await self._index_storage.activate(material, version_id)
        return MaterialIndexResult(
            version_id=version_id,
            key_term_result=key_term_result,
            chunk_count=len(records),
        )

    async def find_existing(self, material: StagedMaterial) -> ExistingIndexVersion | None:
        """Return a resumable/completed DB result before source or GPU work."""

        self._validate_contract(material)
        return await self._index_storage.find_existing(material)

    async def _read_parse_and_chunk(
        self,
        material: StagedMaterial,
    ) -> tuple[ParsedPresentation, tuple[MaterialChunk, ...]]:
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
        return presentation, chunks

    async def _extract_key_terms(
        self,
        presentation: ParsedPresentation,
        *,
        requested: bool,
    ) -> KeyTermExtractionResult:
        if not requested:
            return KeyTermExtractionResult(status="NOT_REQUESTED")
        if self._key_term_extractor is None:
            logger.warning(
                "PPTX key term extraction was requested without a configured extractor",
                extra={
                    "event": "material.key_term_extraction_failed",
                    "failure_code": "KEY_TERM_EXTRACTOR_UNAVAILABLE",
                },
            )
            return KeyTermExtractionResult(
                status="FAILED",
                failure_code="KEY_TERM_EXTRACTOR_UNAVAILABLE",
            )
        presentation_text = _presentation_text(presentation)
        prompt_limit = getattr(self._key_term_extractor, "max_prompt_chars", None)
        truncated = isinstance(prompt_limit, int) and len(presentation_text) > prompt_limit
        try:
            terms = _deduplicate_key_terms(
                tuple(await self._key_term_extractor.extract(presentation_text))
            )
        except Exception:
            logger.warning(
                "PPTX key term extraction failed; continuing without key terms",
                extra={
                    "event": "material.key_term_extraction_failed",
                    "failure_code": "KEY_TERM_EXTRACTION_FAILED",
                },
                exc_info=True,
            )
            return KeyTermExtractionResult(
                status="FAILED",
                failure_code="KEY_TERM_EXTRACTION_FAILED",
                truncated=truncated,
            )
        if not terms:
            return KeyTermExtractionResult(status="EMPTY", truncated=truncated)
        return KeyTermExtractionResult(status="READY", terms=terms, truncated=truncated)

    async def _persist_key_term_result(
        self,
        version_id: int,
        result: KeyTermExtractionResult,
    ) -> KeyTermExtractionResult:
        if result.status == "NOT_REQUESTED":
            return result
        if self._key_term_storage is None:
            return result
        try:
            store_result = getattr(self._key_term_storage, "store_result", None)
            if store_result is not None:
                await store_result(version_id, result)
            elif result.status == "READY":
                await self._key_term_storage.store(version_id, result.terms)
            return result
        except Exception:
            logger.warning(
                "storing PPTX key term result failed; continuing with embedding",
                extra={
                    "event": "material.key_term_storage_failed",
                    "failure_code": "KEY_TERM_STORAGE_FAILED",
                },
                exc_info=True,
            )
            failed = KeyTermExtractionResult(
                status="FAILED",
                failure_code="KEY_TERM_STORAGE_FAILED",
                truncated=result.truncated,
            )
            try:
                store_result = getattr(self._key_term_storage, "store_result", None)
                if store_result is not None:
                    await store_result(version_id, failed)
            except Exception as failure_persistence_error:
                logger.warning(
                    "persisting the key term failure result also failed; retrying the job",
                    extra={"event": "material.key_term_result_persistence_failed"},
                    exc_info=True,
                )
                raise failure_persistence_error
            return failed

    async def _load_key_term_result(
        self,
        version_id: int,
    ) -> KeyTermExtractionResult | None:
        if self._key_term_storage is None:
            return None
        load_result = getattr(self._key_term_storage, "load_result", None)
        if load_result is None:
            return None
        return await load_result(version_id)

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


def _presentation_text(presentation: ParsedPresentation) -> str:
    lines: list[str] = []
    current_page: int | None = None
    for block in presentation.blocks:
        if block.page != current_page:
            lines.append(f"[슬라이드{block.page}]")
            current_page = block.page
        lines.append(block.text)
    return "\n".join(lines)


def _deduplicate_key_terms(key_terms: tuple[KeyTerm, ...]) -> tuple[KeyTerm, ...]:
    deduplicated: dict[str, KeyTerm] = {}
    for key_term in key_terms:
        normalized = KeyTerm(
            term=key_term.term.strip(),
            definition=key_term.definition.strip(),
        )
        deduplicated[normalized.term] = normalized
    return tuple(deduplicated.values())


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
