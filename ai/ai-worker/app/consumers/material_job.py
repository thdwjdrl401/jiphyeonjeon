from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.adapters.remote_bge_embedding import RemoteEmbeddingError
from app.adapters.spring_material_asset_store import SpringMaterialSourceError
from app.adapters.spring_material_callback import SpringCallbackError
from app.application import (
    annotation_embed_job_id,
    embed_delete_job_id,
    map_annotation_embed_job,
)
from app.contracts import (
    AnnotationCallbackEvent,
    AnnotationCallbackStatus,
    AnnotationCallbackType,
    AnnotationEmbedDeleteJob,
    AnnotationEmbedJob,
    EmbedDeleteJob,
    KeyTermPayload,
    MaterialCallbackEvent,
    MaterialCallbackStatus,
    MaterialCallbackType,
    PptxEmbedJob,
    annotation_callback_event_id,
    material_callback_event_id,
    parse_material_job,
)
from app.domain import MaterialIngestionError, StaleMaterialVersionError
from app.ingestion import KeyTerm

if TYPE_CHECKING:
    from app.wiring import PptxIngestionRuntime


class PermanentMaterialJobError(RuntimeError):
    """The original message must not be retried as-is."""


# Annotation jobs that arrive before the feature is switched on go to the DLQ rather than
# being acked away: turning the switch on and re-publishing the DLQ recovers them, so a
# deployment-order mismatch costs nothing (ADR-0043 §2).
_ANNOTATION_DISABLED = "annotation ingestion is disabled on this worker"


class MaterialJobHandler:
    """Validate one Spring message and run its terminal callback exactly by phase."""

    def __init__(self, runtime: PptxIngestionRuntime) -> None:
        self._runtime = runtime

    async def handle(self, body: bytes) -> None:
        try:
            job = parse_material_job(body)
        except (ValueError, TypeError) as exc:
            raise PermanentMaterialJobError("invalid material job envelope") from exc

        if isinstance(job, AnnotationEmbedJob):
            await self._handle_annotation_embed(job)
            return
        if isinstance(job, AnnotationEmbedDeleteJob):
            await self._handle_annotation_delete(job)
            return
        if isinstance(job, EmbedDeleteJob):
            await self._handle_delete(job)
            return
        await self._handle_embed(job)

    async def _handle_annotation_embed(self, job: AnnotationEmbedJob) -> None:
        use_case = self._runtime.index_annotation_highlight
        if use_case is None:
            raise PermanentMaterialJobError(_ANNOTATION_DISABLED)

        job_id = annotation_embed_job_id(job.highlight_id)
        try:
            await use_case.execute(map_annotation_embed_job(job))
        except Exception as exc:
            if _is_retryable(exc):
                raise
            await self._send_annotation_terminal(
                job.highlight_id, job_id, "ANNOTATION_EMBED_FAILED", "FAILED"
            )
            raise PermanentMaterialJobError("annotation indexing failed permanently") from exc

        await self._send_annotation_terminal(
            job.highlight_id, job_id, "ANNOTATION_EMBEDDED", "READY"
        )

    async def _handle_annotation_delete(self, job: AnnotationEmbedDeleteJob) -> None:
        """Withdrawal sends no callback.

        ADR-0074 defined annotation callbacks for indexing only, and there is no
        ANNOTATION_DELETED eventType to report with — inventing one would change a shared
        contract unilaterally. Success is silent; a permanent failure lands in the DLQ, which
        is the operational signal until the owners agree on a delete eventType.
        """

        use_case = self._runtime.delete_annotation_highlight
        if use_case is None:
            raise PermanentMaterialJobError(_ANNOTATION_DISABLED)

        try:
            await use_case.execute(job.highlight_id)
        except Exception as exc:
            if _is_retryable(exc):
                raise
            raise PermanentMaterialJobError("annotation delete failed permanently") from exc

    async def _handle_embed(self, job: PptxEmbedJob) -> None:
        material = self._runtime.material_for(job)
        try:
            result = await self._runtime.index_pptx_material.execute(material)
        except Exception as exc:
            if _is_retryable(exc):
                raise
            await self._send_terminal(job, material.job_id, "MATERIAL_EMBED_FAILED", "FAILED")
            raise PermanentMaterialJobError("material ingestion failed permanently") from exc

        await self._send_terminal(
            job, material.job_id, "MATERIAL_EMBEDDED", "READY", key_terms=result.key_terms
        )

    async def _handle_delete(self, job: EmbedDeleteJob) -> None:
        job_id = embed_delete_job_id(job.material_id)
        try:
            await self._runtime.delete_material_index.execute(job)
        except Exception as exc:
            if _is_retryable(exc):
                raise
            await self._send_terminal(job, job_id, "MATERIAL_DELETE_FAILED", "FAILED")
            raise PermanentMaterialJobError("material delete failed permanently") from exc

        await self._send_terminal(job, job_id, "MATERIAL_DELETED", "DELETED")

    async def report_retry_exhausted(self, body: bytes) -> None:
        """Report failure unless DB completion proves the terminal callback is only pending."""

        try:
            job = parse_material_job(body)
        except (ValueError, TypeError):
            return

        if isinstance(job, AnnotationEmbedDeleteJob):
            return
        if isinstance(job, AnnotationEmbedJob):
            if self._runtime.index_annotation_highlight is None:
                return
            await self._send_annotation_terminal(
                job.highlight_id,
                annotation_embed_job_id(job.highlight_id),
                "ANNOTATION_EMBED_FAILED",
                "FAILED",
            )
            return

        if isinstance(job, EmbedDeleteJob):
            job_id = embed_delete_job_id(job.material_id)
            if not await self._runtime.delete_material_index.has_pending_data(job):
                return
            await self._send_terminal(job, job_id, "MATERIAL_DELETE_FAILED", "FAILED")
            return

        material = self._runtime.material_for(job)
        existing = await self._runtime.index_pptx_material.find_existing(material)
        if existing is not None and not existing.activation_required:
            return
        await self._send_terminal(job, material.job_id, "MATERIAL_EMBED_FAILED", "FAILED")

    async def _send_annotation_terminal(
        self,
        highlight_id: UUID,
        job_id: str,
        event_type: AnnotationCallbackType,
        status: AnnotationCallbackStatus,
    ) -> None:
        event = AnnotationCallbackEvent(
            eventId=annotation_callback_event_id(job_id, event_type),
            eventType=event_type,
            jobId=job_id,
            highlightId=highlight_id,
            status=status,
        )
        try:
            await self._runtime.callback_client.send(event)
        except SpringCallbackError as exc:
            if exc.retryable:
                raise
            raise PermanentMaterialJobError("terminal callback was rejected permanently") from exc

    async def _send_terminal(
        self,
        job: PptxEmbedJob | EmbedDeleteJob,
        job_id: str,
        event_type: MaterialCallbackType,
        status: MaterialCallbackStatus,
        key_terms: Sequence[KeyTerm] = (),
    ) -> None:
        payload: dict[str, object] = {
            "eventId": material_callback_event_id(job_id, event_type),
            "eventType": event_type,
            "jobId": job_id,
            "materialId": job.material_id,
            "lessonId": job.lesson_id,
            "status": status,
        }
        if key_terms:
            payload["keyTerms"] = [
                KeyTermPayload(term=term.term, definition=term.definition) for term in key_terms
            ]
        event = MaterialCallbackEvent.model_validate(payload)
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
