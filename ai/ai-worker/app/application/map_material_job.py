from __future__ import annotations

from app.contracts import PptxEmbedJob
from app.domain import BGE_M3_MODEL, StagedMaterial
from app.ingestion import chunk_strategy


SPRING_ASSET_SOURCE = "spring-asset"
MATERIAL_VERSION_V1 = 1


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
