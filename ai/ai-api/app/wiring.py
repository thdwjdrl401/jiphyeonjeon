from collections.abc import Callable, Mapping
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.adapters import (
    BoundedLectureNoteModel,
    CAPTION_CONSUMER_GROUP,
    CaptionConsumerState,
    GmsOpenAIAnswerModel,
    GmsOpenAIAnswerModelV2,
    GmsOpenAILectureNoteModel,
    PgvectorActiveMaterialRepository,
    PgvectorAnnotationRepository,
    RedisCaptionConsumer,
    RedisConversationMemoryStore,
    RedisLectureNoteStore,
    RemoteBgeM3QueryEmbedding,
)
from app.captions import CaptionContextStore, parse_caption_entry
from app.config import Settings
from app.lecture_notes import (
    LectureNotePipeline,
    LectureNoteService,
    LectureNoteWindowAccumulator,
)
from app.rag import (
    CombinedEvidenceRetriever,
    InMemoryRequestRegistry,
    RagAnswerService,
    ReplayAnswerService,
    ReplayEvidenceRetriever,
)
from app.retrieval import ActiveMaterialRetrievalService, AnnotationRetrievalService

LECTURE_NOTE_CONSUMER_GROUP = "ai-live-notes-mvp-v1"


@dataclass(slots=True)
class RagContextServices:
    store: CaptionContextStore
    consumer: RedisCaptionConsumer
    consumer_state: CaptionConsumerState
    engine: AsyncEngine
    embedding: RemoteBgeM3QueryEmbedding
    retriever: CombinedEvidenceRetriever

    async def close(self) -> None:
        try:
            await self.embedding.aclose()
        finally:
            await self.engine.dispose()


@dataclass(slots=True)
class RagServices:
    service: RagAnswerService
    context: RagContextServices
    answer_model: GmsOpenAIAnswerModel
    registry: InMemoryRequestRegistry
    conversation_memory: RedisConversationMemoryStore

    async def close(self) -> None:
        try:
            await self.answer_model.aclose()
        finally:
            try:
                await self.conversation_memory.aclose()
            finally:
                await self.context.close()


@dataclass(slots=True)
class LectureNoteServices:
    accumulator: LectureNoteWindowAccumulator
    service: LectureNoteService
    pipeline: LectureNotePipeline
    consumer: RedisCaptionConsumer
    consumer_state: CaptionConsumerState
    model: BoundedLectureNoteModel
    store: RedisLectureNoteStore

    async def restore(self) -> None:
        await self.pipeline.restore()

    async def close(self) -> None:
        """모델 호출을 비운 뒤 외부 client를 모두 닫는다."""
        async with AsyncExitStack() as cleanup:
            cleanup.push_async_callback(self.store.aclose)
            cleanup.push_async_callback(self.model.aclose)
            await self.service.aclose()


def _build_caption_consumer(
    settings: Settings,
    *,
    consumer_name: str,
    group_name: str,
    handle_entry: Callable[[Mapping[Any, Any]], object],
    after_ack: Callable[[Mapping[Any, Any]], object] | None = None,
    after_owned_pending_drained: Callable[[], object] | None = None,
) -> tuple[RedisCaptionConsumer, CaptionConsumerState]:
    """두 caption 소비 경로가 공유하는 Redis 연결 정책을 한곳에서 조립한다."""
    state = CaptionConsumerState()
    consumer = RedisCaptionConsumer(
        settings.redis_url,
        consumer_name,
        handle_entry,
        after_ack=after_ack,
        after_owned_pending_drained=after_owned_pending_drained,
        state=state,
        stream_key=settings.caption_stream_key,
        group_name=group_name,
        batch_size=settings.caption_batch_size,
        block_ms=settings.caption_poll_block_ms,
        reconnect_min_seconds=settings.redis_reconnect_min_seconds,
        reconnect_max_seconds=settings.redis_reconnect_max_seconds,
        socket_connect_timeout_seconds=settings.redis_connect_timeout_seconds,
        socket_timeout_seconds=settings.redis_socket_timeout_seconds,
    )
    return consumer, state


def build_rag_context_services(settings: Settings) -> RagContextServices:
    if settings.database_url is None:
        raise ValueError("AI_API_DATABASE_URL is required to build RAG context services")
    if settings.bge_base_url is None or settings.bge_token is None:
        raise ValueError("AI_API_BGE_BASE_URL and AI_API_BGE_TOKEN are required")

    store = CaptionContextStore(
        lookback_ms=settings.caption_context_lookback_ms,
        max_events_per_session=settings.caption_context_max_events,
        max_bytes_per_session=settings.caption_context_max_bytes,
        max_sessions=settings.caption_context_max_sessions,
        max_retired_attempts_per_session=settings.caption_context_max_retired_attempts,
    )

    def handle_entry(fields: Mapping[Any, Any]) -> None:
        store.ingest(parse_caption_entry(fields))

    consumer, consumer_state = _build_caption_consumer(
        settings,
        consumer_name=settings.instance_id,
        group_name=CAPTION_CONSUMER_GROUP,
        handle_entry=handle_entry,
    )
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    embedding = RemoteBgeM3QueryEmbedding(
        base_url=settings.bge_base_url,
        token=settings.bge_token.get_secret_value(),
        model=settings.bge_model,
        revision=settings.bge_revision,
        timeout_seconds=settings.bge_timeout_seconds,
    )
    materials = ActiveMaterialRetrievalService(
        embedding,
        PgvectorActiveMaterialRepository(engine, runtime_role=settings.database_role),
    )
    retriever = CombinedEvidenceRetriever(
        materials,
        store,
        annotations=_build_annotation_retrieval(settings, engine, embedding),
        annotation_top_k=settings.annotation_top_k,
        annotation_window_size=settings.annotation_window_size,
        material_top_k=settings.material_top_k,
        material_vector_threshold=settings.material_vector_threshold,
        material_lexical_threshold=settings.material_lexical_threshold,
        caption_max_items=settings.caption_evidence_max_items,
        caption_max_chars=settings.caption_evidence_max_chars,
    )
    return RagContextServices(
        store=store,
        consumer=consumer,
        consumer_state=consumer_state,
        engine=engine,
        embedding=embedding,
        retriever=retriever,
    )


@dataclass(slots=True)
class ReplayServices:
    """Replay (v2) counterpart of RagServices. Owns its own DB engine/embedding client rather
    than sharing RagContextServices' — Replay doesn't consume captions, so it has no Redis
    consumer to coordinate shutdown with, and keeping the two independent avoids coupling their
    lifecycles together for no benefit."""

    service: ReplayAnswerService
    engine: AsyncEngine
    embedding: RemoteBgeM3QueryEmbedding
    retriever: ReplayEvidenceRetriever
    answer_model: GmsOpenAIAnswerModelV2
    registry: InMemoryRequestRegistry

    async def close(self) -> None:
        try:
            await self.answer_model.aclose()
        finally:
            try:
                await self.embedding.aclose()
            finally:
                await self.engine.dispose()


def build_replay_rag_services(settings: Settings) -> ReplayServices:
    if settings.database_url is None:
        raise ValueError("AI_API_DATABASE_URL is required to build Replay RAG services")
    if settings.bge_base_url is None or settings.bge_token is None:
        raise ValueError("AI_API_BGE_BASE_URL and AI_API_BGE_TOKEN are required")
    if settings.gms_api_key is None:
        raise ValueError("AI_API_GMS_API_KEY is required to build Replay RAG services")

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    embedding = RemoteBgeM3QueryEmbedding(
        base_url=settings.bge_base_url,
        token=settings.bge_token.get_secret_value(),
        model=settings.bge_model,
        revision=settings.bge_revision,
        timeout_seconds=settings.bge_timeout_seconds,
    )
    materials = ActiveMaterialRetrievalService(
        embedding,
        PgvectorActiveMaterialRepository(engine, runtime_role=settings.database_role),
    )
    retriever = ReplayEvidenceRetriever(
        materials,
        annotations=_build_annotation_retrieval(settings, engine, embedding),
        annotation_top_k=settings.annotation_top_k,
        annotation_window_size=settings.annotation_window_size,
        material_top_k=settings.material_top_k,
        material_vector_threshold=settings.material_vector_threshold,
        material_lexical_threshold=settings.material_lexical_threshold,
    )
    answer_model = GmsOpenAIAnswerModelV2(
        api_key=settings.gms_api_key.get_secret_value(),
        model=settings.gms_model,
        max_output_tokens=settings.gms_max_output_tokens,
        max_prompt_chars=settings.gms_max_prompt_chars,
        timeout_seconds=settings.gms_timeout_seconds,
    )
    registry = InMemoryRequestRegistry(
        max_active=settings.rag_request_max_active,
        max_completed=settings.rag_request_max_completed,
    )
    service = ReplayAnswerService(
        retriever,
        answer_model,
        registry,
        retrieval_timeout_seconds=settings.rag_retrieval_timeout_seconds,
        model_timeout_seconds=settings.rag_model_timeout_seconds,
    )
    return ReplayServices(
        service=service,
        engine=engine,
        embedding=embedding,
        retriever=retriever,
        answer_model=answer_model,
        registry=registry,
    )


def build_answer_model(settings: Settings) -> GmsOpenAIAnswerModel:
    if settings.gms_api_key is None:
        raise ValueError("AI_API_GMS_API_KEY is required to build the GMS answer model")
    return GmsOpenAIAnswerModel(
        api_key=settings.gms_api_key.get_secret_value(),
        model=settings.gms_model,
        max_output_tokens=settings.gms_max_output_tokens,
        max_prompt_chars=settings.gms_max_prompt_chars,
        timeout_seconds=settings.gms_timeout_seconds,
    )


def build_lecture_note_services(settings: Settings) -> LectureNoteServices:
    if settings.gms_api_key is None:
        raise ValueError("AI_API_GMS_API_KEY is required to build lecture note services")
    accumulator = LectureNoteWindowAccumulator(
        min_window_ms=settings.lecture_note_min_window_ms,
        target_window_ms=settings.lecture_note_target_window_ms,
        max_window_ms=settings.lecture_note_max_window_ms,
        min_chars=settings.lecture_note_min_chars,
        max_chars=settings.lecture_note_max_chars,
    )
    gms_model = GmsOpenAILectureNoteModel(
        api_key=settings.gms_api_key.get_secret_value(),
        model=settings.lecture_note_model or settings.gms_model,
        max_output_tokens=settings.lecture_note_max_output_tokens,
        max_prompt_chars=settings.lecture_note_max_prompt_chars,
        timeout_seconds=settings.lecture_note_timeout_seconds,
        refinement_max_output_tokens=settings.lecture_note_refinement_max_output_tokens,
        refinement_max_prompt_chars=settings.lecture_note_refinement_max_prompt_chars,
        refinement_timeout_seconds=settings.lecture_note_refinement_timeout_seconds,
    )
    model = BoundedLectureNoteModel(
        gms_model,
        max_concurrency=settings.lecture_note_gms_max_concurrency,
        refinement_max_concurrency=(
            settings.lecture_note_gms_refinement_max_concurrency
        ),
        max_consecutive_live=settings.lecture_note_gms_max_consecutive_live,
        max_attempts=settings.lecture_note_gms_max_attempts,
        retry_base_seconds=settings.lecture_note_gms_retry_base_seconds,
        retry_max_seconds=settings.lecture_note_gms_retry_max_seconds,
    )
    store = RedisLectureNoteStore(
        settings.redis_url,
        stream_maxlen=settings.lecture_note_stream_maxlen,
        socket_connect_timeout_seconds=settings.redis_connect_timeout_seconds,
        socket_timeout_seconds=settings.redis_socket_timeout_seconds,
    )
    service = LectureNoteService(
        model,
        store,
        accumulator,
        refinement_model=model,
    )
    pipeline = LectureNotePipeline(accumulator, service)

    async def handle_entry(fields: Mapping[Any, Any]) -> None:
        await pipeline.ingest(parse_caption_entry(fields))

    async def after_ack(fields: Mapping[Any, Any]) -> None:
        await pipeline.after_ack(parse_caption_entry(fields))

    async def after_owned_pending_drained() -> None:
        await pipeline.after_owned_pending_drained()

    consumer, consumer_state = _build_caption_consumer(
        settings,
        consumer_name=f"{settings.instance_id}:live-notes-mvp",
        group_name=LECTURE_NOTE_CONSUMER_GROUP,
        handle_entry=handle_entry,
        after_ack=after_ack,
        after_owned_pending_drained=after_owned_pending_drained,
    )
    return LectureNoteServices(
        accumulator=accumulator,
        service=service,
        pipeline=pipeline,
        consumer=consumer,
        consumer_state=consumer_state,
        model=model,
        store=store,
    )


def _build_annotation_retrieval(
    settings: Settings,
    engine: AsyncEngine,
    embedding: RemoteBgeM3QueryEmbedding,
) -> AnnotationRetrievalService | None:
    """None while the switch is off, which leaves both RAG paths exactly as they were.

    Reuses the caller's engine and query embedding client: annotation snapshots live in the
    same database and are embedded by the same model as material chunks, so a second
    connection pool would buy nothing (ADR-0043 §4).
    """

    if not settings.annotation_evidence_enabled:
        return None
    return AnnotationRetrievalService(
        embedding,
        PgvectorAnnotationRepository(engine, runtime_role=settings.database_role),
    )


def build_rag_services(settings: Settings) -> RagServices:
    if settings.database_url is None:
        raise ValueError("AI_API_DATABASE_URL is required to build RAG services")
    if settings.bge_base_url is None or settings.bge_token is None:
        raise ValueError("AI_API_BGE_BASE_URL and AI_API_BGE_TOKEN are required")
    if settings.gms_api_key is None:
        raise ValueError("AI_API_GMS_API_KEY is required to build RAG services")
    context = build_rag_context_services(settings)
    answer_model = build_answer_model(settings)
    registry = InMemoryRequestRegistry(
        max_active=settings.rag_request_max_active,
        max_completed=settings.rag_request_max_completed,
    )
    conversation_memory = RedisConversationMemoryStore(
        settings.redis_url,
        key_prefix=settings.conversation_memory_key_prefix,
        ttl_seconds=settings.conversation_memory_ttl_seconds,
        socket_connect_timeout_seconds=settings.redis_connect_timeout_seconds,
        socket_timeout_seconds=settings.redis_socket_timeout_seconds,
    )
    service = RagAnswerService(
        context.retriever,
        answer_model,
        registry,
        retrieval_timeout_seconds=settings.rag_retrieval_timeout_seconds,
        model_timeout_seconds=settings.rag_model_timeout_seconds,
        conversation_memory=conversation_memory,
    )
    return RagServices(
        service=service,
        context=context,
        answer_model=answer_model,
        registry=registry,
        conversation_memory=conversation_memory,
    )
