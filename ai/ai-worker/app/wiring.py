from __future__ import annotations

import logging

from dataclasses import dataclass

from httpx import AsyncClient, HTTPError
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.adapters.gms_annotation_reader import GmsAnnotationReader
from app.adapters.gms_key_term_extractor import GmsKeyTermExtractor
from app.adapters.pgvector_annotation_index import PgvectorAnnotationIndexRepository
from app.adapters.pgvector_index import PgvectorIndexRepository
from app.adapters.pgvector_key_term_storage import PgvectorKeyTermRepository
from app.adapters.rabbitmq_material_consumer import RabbitMaterialConsumer
from app.adapters.remote_bge_embedding import RemoteBgeM3EmbeddingModel
from app.adapters.spring_hmac import SpringHmacSigner
from app.adapters.spring_material_asset_store import SpringPresignedPptxAssetStore
from app.adapters.spring_material_callback import SpringMaterialCallbackClient
from app.application import (
    DeleteAnnotationSnapshot,
    DeleteMaterialIndex,
    IndexAnnotationSnapshot,
    IndexPptxMaterial,
    map_pptx_embed_job,
)
from app.domain import MAX_ANNOTATION_TEXT_CHARS
from app.config import Settings
from app.consumers import MaterialJobHandler
from app.contracts import PptxEmbedJob
from app.domain import StagedMaterial
from app.ingestion import PptxValidationLimits
from app.runtime import WorkerRuntime, WorkerState


logger = logging.getLogger(__name__)


class PptxRuntimeConfigurationError(RuntimeError):
    """Credentials required to activate the runtime adapters are absent."""


@dataclass(slots=True)
class PptxIngestionRuntime:
    index_pptx_material: IndexPptxMaterial
    delete_material_index: DeleteMaterialIndex
    callback_client: SpringMaterialCallbackClient
    tenant_id: str
    model_revision: str
    chunk_max_chars: int
    _spring_client: AsyncClient
    _embedding_client: AsyncClient
    _database_engine: AsyncEngine
    _bge_readiness_timeout_seconds: float
    # Both stay None while AI_WORKER_ANNOTATION_INGESTION_ENABLED is off; the handler routes
    # annotation jobs to the DLQ rather than pretending to index them (ADR-0043 §2).
    index_annotation_snapshot: IndexAnnotationSnapshot | None = None
    delete_annotation_snapshot: DeleteAnnotationSnapshot | None = None
    _key_term_extractor: GmsKeyTermExtractor | None = None
    _annotation_reader: GmsAnnotationReader | None = None
    _bge_readiness_failure: str | None = None
    _closed: bool = False

    def material_for(self, job: PptxEmbedJob) -> StagedMaterial:
        return map_pptx_embed_job(
            job,
            tenant_id=self.tenant_id,
            model_revision=self.model_revision,
            chunk_max_chars=self.chunk_max_chars,
        )

    async def dependencies_ready(self) -> bool:
        async with self._database_engine.connect() as connection:
            if (await connection.scalar(text("SELECT 1"))) != 1:
                return False

        try:
            response = await self._embedding_client.get(
                "/readyz",
                timeout=self._bge_readiness_timeout_seconds,
            )
        except HTTPError:
            self._record_bge_readiness_failure("unreachable")
            return False
        if response.status_code != 200:
            self._record_bge_readiness_failure("http_status")
            return False
        try:
            payload = response.json()
        except ValueError:
            self._record_bge_readiness_failure("invalid_json")
            return False

        ready = (
            isinstance(payload, dict)
            and payload.get("status") == "ready"
            and payload.get("service") == "bge-runtime"
        )
        self._record_bge_readiness_failure(None if ready else "invalid_payload")
        return ready

    def _record_bge_readiness_failure(self, failure: str | None) -> None:
        if self._bge_readiness_failure == failure:
            return
        recovered = self._bge_readiness_failure is not None and failure is None
        self._bge_readiness_failure = failure
        if recovered:
            logger.info(
                "bge-runtime readiness recovered",
                extra={
                    "event": "service.dependency_recovered",
                    "dependency": "bge-runtime",
                },
            )
        elif failure is not None:
            logger.warning(
                "bge-runtime readiness check failed",
                extra={
                    "event": "service.dependency_not_ready",
                    "dependency": "bge-runtime",
                    "reason": failure,
                },
            )

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            await self._spring_client.aclose()
        finally:
            try:
                await self._embedding_client.aclose()
            finally:
                try:
                    if self._key_term_extractor is not None:
                        await self._key_term_extractor.aclose()
                finally:
                    try:
                        if self._annotation_reader is not None:
                            await self._annotation_reader.aclose()
                    finally:
                        await self._database_engine.dispose()


def build_pptx_ingestion_runtime(settings: Settings) -> PptxIngestionRuntime:
    """Build executable adapters without starting a RabbitMQ consumer."""

    spring_hmac_secret = _required_secret(
        settings.spring_hmac_secret,
        "AI_CALLBACK_SECRET",
    )
    bge_internal_token = _required_secret(
        settings.bge_internal_token,
        "AI_WORKER_BGE_INTERNAL_TOKEN",
    )

    signer = SpringHmacSigner(spring_hmac_secret)
    spring_client = AsyncClient(base_url=settings.spring_internal_base_url)
    embedding_client = AsyncClient(base_url=settings.bge_runtime_url)
    database_engine = create_async_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
    )
    asset_store = SpringPresignedPptxAssetStore(
        spring_client,
        signer,
        source_max_bytes=settings.source_max_bytes,
        annotation_image_max_bytes=settings.annotation_image_max_bytes,
        issue_timeout_seconds=settings.spring_url_issue_timeout_seconds,
        download_timeout_seconds=settings.spring_download_timeout_seconds,
    )
    embedding_model = RemoteBgeM3EmbeddingModel(
        embedding_client,
        internal_token=bge_internal_token,
        model_name=settings.embedding_model,
        model_revision=settings.embedding_revision,
        max_batch_size=settings.embedding_max_batch_size,
        max_text_chars=settings.embedding_max_text_chars,
        request_timeout_seconds=settings.bge_request_timeout_seconds,
    )
    callback_client = SpringMaterialCallbackClient(
        spring_client,
        signer,
        timeout_seconds=settings.spring_callback_timeout_seconds,
    )
    key_term_extractor: GmsKeyTermExtractor | None = None
    if settings.key_term_extraction_enabled:
        gms_api_key = _required_secret(settings.gms_api_key, "AI_WORKER_GMS_API_KEY")
        key_term_extractor = GmsKeyTermExtractor(
            api_key=gms_api_key,
            model=settings.gms_model,
            max_output_tokens=settings.gms_max_output_tokens,
            max_prompt_chars=settings.gms_max_prompt_chars,
            timeout_seconds=settings.gms_timeout_seconds,
        )
    annotation_reader: GmsAnnotationReader | None = None
    index_annotation_snapshot: IndexAnnotationSnapshot | None = None
    delete_annotation_snapshot: DeleteAnnotationSnapshot | None = None
    if settings.annotation_ingestion_enabled:
        annotation_gms_api_key = _required_secret(settings.gms_api_key, "AI_WORKER_GMS_API_KEY")
        annotation_reader = GmsAnnotationReader(
            api_key=annotation_gms_api_key,
            model=settings.annotation_model or settings.gms_model,
            max_output_tokens=settings.gms_max_output_tokens,
            max_text_chars=MAX_ANNOTATION_TEXT_CHARS,
            timeout_seconds=settings.gms_timeout_seconds,
        )
        annotation_index = PgvectorAnnotationIndexRepository(database_engine)
        index_annotation_snapshot = IndexAnnotationSnapshot(
            asset_store,
            embedding_model,
            annotation_index,
            reader=annotation_reader,
        )
        delete_annotation_snapshot = DeleteAnnotationSnapshot(annotation_index)

    index_storage = PgvectorIndexRepository(database_engine)
    index_pptx_material = IndexPptxMaterial(
        asset_store,
        embedding_model,
        index_storage,
        validation_limits=PptxValidationLimits(source_max_bytes=settings.source_max_bytes),
        chunk_max_chars=settings.chunk_max_chars,
        key_term_extractor=key_term_extractor,
        key_term_storage=PgvectorKeyTermRepository(database_engine),
    )
    delete_material_index = DeleteMaterialIndex(
        index_storage,
        tenant_id=settings.tenant_id,
        model_revision=settings.embedding_revision,
        chunk_max_chars=settings.chunk_max_chars,
    )
    return PptxIngestionRuntime(
        index_pptx_material=index_pptx_material,
        delete_material_index=delete_material_index,
        callback_client=callback_client,
        tenant_id=settings.tenant_id,
        model_revision=settings.embedding_revision,
        chunk_max_chars=settings.chunk_max_chars,
        _spring_client=spring_client,
        _embedding_client=embedding_client,
        _database_engine=database_engine,
        _bge_readiness_timeout_seconds=settings.bge_readiness_timeout_seconds,
        index_annotation_snapshot=index_annotation_snapshot,
        delete_annotation_snapshot=delete_annotation_snapshot,
        _key_term_extractor=key_term_extractor,
        _annotation_reader=annotation_reader,
    )


def build_worker_runtime(settings: Settings, state: WorkerState) -> WorkerRuntime:
    if not settings.material_ingestion_enabled:
        return WorkerRuntime(state)

    rabbitmq_url = _required_secret(settings.rabbitmq_url, "AI_WORKER_RABBITMQ_URL")
    ingestion_runtime = build_pptx_ingestion_runtime(settings)
    handler = MaterialJobHandler(ingestion_runtime)
    consumer = RabbitMaterialConsumer(
        rabbitmq_url,
        handler,
        retry_limit=settings.rabbitmq_retry_limit,
        retry_base_delay_seconds=settings.rabbitmq_retry_base_delay_seconds,
        shutdown_grace_seconds=settings.rabbitmq_shutdown_grace_seconds,
        readiness_check=ingestion_runtime.dependencies_ready,
        on_ready=lambda ready: setattr(state, "ready", ready),
    )
    return WorkerRuntime(
        state,
        runner=consumer,
        close=ingestion_runtime.aclose,
    )


def _required_secret(value: SecretStr | None, environment_name: str) -> str:
    if value is None:
        raise PptxRuntimeConfigurationError(f"{environment_name} is required for PPTX runtime")
    return value.get_secret_value()
