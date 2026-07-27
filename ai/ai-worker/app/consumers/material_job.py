from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.exc import SQLAlchemyError

from app.adapters.remote_bge_embedding import RemoteEmbeddingError
from app.adapters.spring_material_asset_store import SpringMaterialSourceError
from app.adapters.spring_material_callback import SpringCallbackError
from app.contracts import (
    MaterialCallbackEvent,
    MaterialCallbackStatus,
    MaterialCallbackType,
    PptxEmbedJob,
    material_callback_event_id,
    parse_material_job,
)
from app.domain import MaterialIngestionError, StagedMaterial, StaleMaterialVersionError

if TYPE_CHECKING:
    from app.wiring import PptxIngestionRuntime


class PermanentMaterialJobError(RuntimeError):
    """The original message must not be retried as-is."""


class MaterialJobHandler:
    """Validate one Spring message and run its terminal callback exactly by phase."""

    def __init__(self, runtime: PptxIngestionRuntime) -> None:
        self._runtime = runtime

    async def handle(self, body: bytes) -> None:
        try:
            job = parse_material_job(body)
        except (ValueError, TypeError) as exc:
            raise PermanentMaterialJobError("invalid material job envelope") from exc
        if not isinstance(job, PptxEmbedJob):
            raise PermanentMaterialJobError("EMBED_DELETE requires the pending scope resolver")

        material = self._runtime.material_for(job)
        try:
            await self._runtime.index_pptx_material.execute(material)
        except Exception as exc:
            if _is_retryable(exc):
                raise
            await self._send_terminal(job, material, "MATERIAL_EMBED_FAILED", "FAILED")
            raise PermanentMaterialJobError("material ingestion failed permanently") from exc

        await self._send_terminal(job, material, "MATERIAL_EMBEDDED", "READY")

    async def report_retry_exhausted(self, body: bytes) -> None:
        """Report failure unless DB completion proves only the READY callback is pending."""

        try:
            job = parse_material_job(body)
        except (ValueError, TypeError):
            return
        if not isinstance(job, PptxEmbedJob):
            return

        material = self._runtime.material_for(job)
        existing = await self._runtime.index_pptx_material.find_existing(material)
        if existing is not None and not existing.activation_required:
            return
        await self._send_terminal(job, material, "MATERIAL_EMBED_FAILED", "FAILED")

    async def _send_terminal(
        self,
        job: PptxEmbedJob,
        material: StagedMaterial,
        event_type: MaterialCallbackType,
        status: MaterialCallbackStatus,
    ) -> None:
        event = MaterialCallbackEvent.model_validate(
            {
                "eventId": material_callback_event_id(material.job_id, event_type),
                "eventType": event_type,
                "jobId": material.job_id,
                "materialId": job.material_id,
                "lessonId": job.lesson_id,
                "status": status,
            }
        )
        try:
            await self._runtime.callback_client.send(event)
        except SpringCallbackError as exc:
            if exc.retryable:
                raise
            raise PermanentMaterialJobError("terminal callback was rejected permanently") from exc


def _is_retryable(error: Exception) -> bool:
    if isinstance(error, (SpringMaterialSourceError, RemoteEmbeddingError)):
        return error.retryable
    if isinstance(
        error,
        (
            MaterialIngestionError,
            StaleMaterialVersionError,
            ValueError,
        ),
    ):
        return False
    if isinstance(error, (SQLAlchemyError, TimeoutError, OSError)):
        return True
    return True
