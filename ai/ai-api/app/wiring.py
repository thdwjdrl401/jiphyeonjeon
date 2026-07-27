from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.adapters import (
    CaptionConsumerState,
    GmsOpenAIAnswerModel,
    PgvectorActiveMaterialRepository,
    RedisCaptionConsumer,
    RemoteBgeM3QueryEmbedding,
)
from app.captions import CaptionContextStore, parse_caption_entry
from app.config import Settings
from app.rag import CombinedEvidenceRetriever, InMemoryRequestRegistry, RagAnswerService
from app.retrieval import ActiveMaterialRetrievalService


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

    async def close(self) -> None:
        try:
            await self.answer_model.aclose()
        finally:
            await self.context.close()


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
    consumer_state = CaptionConsumerState()

    def handle_entry(fields: Mapping[Any, Any]) -> None:
        store.ingest(parse_caption_entry(fields))

    consumer = RedisCaptionConsumer(
        settings.redis_url,
        settings.instance_id,
        handle_entry,
        state=consumer_state,
        stream_key=settings.caption_stream_key,
        batch_size=settings.caption_batch_size,
        block_ms=settings.caption_poll_block_ms,
        reconnect_min_seconds=settings.redis_reconnect_min_seconds,
        reconnect_max_seconds=settings.redis_reconnect_max_seconds,
        socket_connect_timeout_seconds=settings.redis_connect_timeout_seconds,
        socket_timeout_seconds=settings.redis_socket_timeout_seconds,
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
    service = RagAnswerService(
        context.retriever,
        answer_model,
        registry,
        retrieval_timeout_seconds=settings.rag_retrieval_timeout_seconds,
        model_timeout_seconds=settings.rag_model_timeout_seconds,
    )
    return RagServices(
        service=service,
        context=context,
        answer_model=answer_model,
        registry=registry,
    )
