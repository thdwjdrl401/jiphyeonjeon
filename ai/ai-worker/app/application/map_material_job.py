from __future__ import annotations

from app.contracts import AnnotationEmbedJob, EmbedDeleteJob, PptxEmbedJob
from app.domain import BGE_M3_MODEL, AnnotationHighlight, MaterialScope, StagedMaterial
from app.ingestion import chunk_strategy


SPRING_ASSET_SOURCE = "spring-asset"
MATERIAL_VERSION_V1 = 1


def annotation_embed_job_id(highlight_id: object) -> str:
    return f"ANNOTATION_EMBED:{highlight_id}"


def annotation_delete_job_id(highlight_id: object) -> str:
    return f"ANNOTATION_EMBED_DELETE:{highlight_id}"


def map_annotation_embed_job(job: AnnotationEmbedJob) -> AnnotationHighlight:
    """Highlights need no tenant, chunk strategy or model revision: one highlight is one
    indexed unit, so nothing about staging or versioning applies."""

    return AnnotationHighlight(
        highlight_id=job.highlight_id,
        curriculum_id=job.curriculum_id,
        lesson_id=job.lesson_id,
        session_id=job.session_id,
        session_ms=job.session_ms,
        captured_at=job.captured_at,
        text=job.text,
    )


def map_pptx_embed_job(
    job: PptxEmbedJob,
    *,
    tenant_id: str,
    model_revision: str,
    chunk_max_chars: int,
) -> StagedMaterial:
    material_id = str(job.material_id)
    return StagedMaterial(
        job_id=f"PPTX_EMBED:{material_id}",
        idempotency_key=f"material:{material_id}:embed",
        tenant_id=tenant_id,
        curriculum_id=job.curriculum_id,
        lesson_id=job.lesson_id,
        material_id=job.material_id,
        material_version=MATERIAL_VERSION_V1,
        source_bucket=SPRING_ASSET_SOURCE,
        source_object_key=str(job.asset_id),
        correlation_id=f"material:{material_id}",
        chunk_strategy=chunk_strategy(chunk_max_chars),
        model_name=BGE_M3_MODEL,
        model_revision=model_revision,
    )


def embed_delete_job_id(material_id: object) -> str:
    return f"EMBED_DELETE:{material_id}"


def map_embed_delete_job(
    job: EmbedDeleteJob,
    *,
    tenant_id: str,
    scope: MaterialScope,
    model_revision: str,
    chunk_max_chars: int,
) -> StagedMaterial:
    """Build the StagedMaterial delete_job() needs from a resolved scope (ADR-0006).

    delete_job() never reads source_bucket/source_object_key/chunk_strategy/model_name/
    model_revision — they're set to schema-valid placeholders only because StagedMaterial's
    shape is shared with the embed path.
    """

    material_id = str(job.material_id)
    return StagedMaterial(
        job_id=embed_delete_job_id(job.material_id),
        idempotency_key=f"material:{material_id}:delete",
        tenant_id=tenant_id,
        curriculum_id=scope.curriculum_id,
        lesson_id=job.lesson_id,
        material_id=job.material_id,
        material_version=scope.material_version,
        source_bucket=SPRING_ASSET_SOURCE,
        source_object_key=material_id,
        correlation_id=f"material:{material_id}",
        chunk_strategy=chunk_strategy(chunk_max_chars),
        model_name=BGE_M3_MODEL,
        model_revision=model_revision,
    )
