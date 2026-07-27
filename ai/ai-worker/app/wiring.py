from __future__ import annotations

from dataclasses import dataclass

from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.adapters.pgvector_index import PgvectorIndexRepository
from app.adapters.rabbitmq_material_consumer import RabbitMaterialConsumer
from app.adapters.remote_bge_embedding import RemoteBgeM3EmbeddingModel
from app.adapters.spring_hmac import SpringHmacSigner
from app.adapters.spring_material_asset_store import SpringPresignedPptxAssetStore
from app.adapters.spring_material_callback import SpringMaterialCallbackClient
from app.application import IndexPptxMaterial, map_pptx_embed_job
from app.config import Settings
from app.consumers import MaterialJobHandler
from app.contracts import PptxEmbedJob
from app.domain import StagedMaterial
from app.ingestion import PptxValidationLimits
from app.runtime import WorkerRuntime, WorkerState


class PptxRuntimeConfigurationError(RuntimeError):
    """Credentials required to activate the runtime adapters are absent."""


@dataclass(slots=True)
class PptxIngestionRuntime:
    index_pptx_material: IndexPptxMaterial
    callback_client: SpringMaterialCallbackClient
    tenant_id: str
    model_revision: str
    chunk_max_chars: int
    _spring_client: AsyncClient
    _embedding_client: AsyncClient
    _database_engine: AsyncEngine
    _closed: bool = False

    def material_for(self, job: PptxEmbedJob) -> StagedMaterial:
        return map_pptx_embed_job(
            job,
            tenant_id=self.tenant_id,
            model_revision=self.model_revision,
            chunk_max_chars=self.chunk_max_chars,
        )

    async def database_ready(self) -> bool:
        async with self._database_engine.connect() as connection:
            return (await connection.scalar(text("SELECT 1"))) == 1

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
    index_pptx_material = IndexPptxMaterial(
        asset_store,
        embedding_model,
        PgvectorIndexRepository(database_engine),
        validation_limits=PptxValidationLimits(source_max_bytes=settings.source_max_bytes),
        chunk_max_chars=settings.chunk_max_chars,
    )
    return PptxIngestionRuntime(
        index_pptx_material=index_pptx_material,
        callback_client=callback_client,
        tenant_id=settings.tenant_id,
        model_revision=settings.embedding_revision,
        chunk_max_chars=settings.chunk_max_chars,
        _spring_client=spring_client,
        _embedding_client=embedding_client,
        _database_engine=database_engine,
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
        readiness_check=ingestion_runtime.database_ready,
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
