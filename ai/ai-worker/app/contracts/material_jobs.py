"""Wire contracts for every job Spring publishes to the shared `ingestion.embed` queue.

PPTX material jobs and annotation snapshot jobs (ADR-0043) travel the same queue and are
discriminated by `taskType`, so one parser owns the whole union.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Literal, TypeAlias
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, TypeAdapter, model_validator


MAX_MATERIAL_JOB_BYTES = 64 * 1024
# Matches ai.annotation_snapshot.text (ADR-0043 §1). A snapshot text that cannot be stored is
# rejected fail-closed rather than silently truncated — the DLQ keeps it for inspection.
MAX_ANNOTATION_TEXT_CHARS = 2_000


class _WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="before")
    @classmethod
    def reject_python_field_names(cls, value: object) -> object:
        if isinstance(value, Mapping):
            for field_name, field in cls.model_fields.items():
                if field.alias is not None and field.alias != field_name and field_name in value:
                    raise ValueError("wire fields must use their camelCase aliases")
        return value


class EmbedPolicy(_WireModel):
    embed_model: Literal["bge-m3"] = Field(alias="embedModel")


class PptxEmbedJob(_WireModel):
    task_type: Literal["PPTX_EMBED"] = Field(alias="taskType")
    material_id: UUID = Field(alias="materialId")
    asset_id: UUID = Field(alias="assetId")
    lesson_id: UUID = Field(alias="lessonId")
    curriculum_id: UUID = Field(alias="curriculumId")
    file_name: str = Field(alias="fileName", max_length=1_024)
    policy: EmbedPolicy
    contract_version: Literal[1] = Field(alias="contractVersion")


class EmbedDeleteJob(_WireModel):
    task_type: Literal["EMBED_DELETE"] = Field(alias="taskType")
    material_id: UUID = Field(alias="materialId")
    lesson_id: UUID = Field(alias="lessonId")
    contract_version: Literal[1] = Field(alias="contractVersion")


class AnnotationEmbedJob(_WireModel):
    """One instructor highlight snapshot to index as timeline-anchored evidence (ADR-0043 §2).

    The image arrives as `asset_id` only — the worker fetches a freshly signed presigned GET at
    processing time, so a job that sits in the queue or retries never carries an expired URL.
    `interpreted_text` is Spring's own interpretation and may be absent or blank; the worker
    reads the image with a model only in that case (ADR-0043 §3).
    """

    task_type: Literal["ANNOTATION_EMBED"] = Field(alias="taskType")
    snapshot_id: UUID = Field(alias="snapshotId")
    asset_id: UUID = Field(alias="assetId")
    session_id: UUID = Field(alias="sessionId")
    lesson_id: UUID = Field(alias="lessonId")
    curriculum_id: UUID = Field(alias="curriculumId")
    session_ms: int = Field(alias="sessionMs", ge=0)
    captured_at: AwareDatetime = Field(alias="capturedAt")
    interpreted_text: str | None = Field(
        default=None, alias="interpretedText", max_length=MAX_ANNOTATION_TEXT_CHARS
    )
    policy: EmbedPolicy
    contract_version: Literal[1] = Field(alias="contractVersion")


class AnnotationEmbedDeleteJob(_WireModel):
    """Remove one snapshot from the evidence index (ADR-0043 §2).

    Unrelated to erasing the stroke: a snapshot records a moment, so its lifetime is decoupled
    from the highlight it came from (ADR-0074).
    """

    task_type: Literal["ANNOTATION_EMBED_DELETE"] = Field(alias="taskType")
    snapshot_id: UUID = Field(alias="snapshotId")
    contract_version: Literal[1] = Field(alias="contractVersion")


MaterialJob: TypeAlias = Annotated[
    PptxEmbedJob | EmbedDeleteJob | AnnotationEmbedJob | AnnotationEmbedDeleteJob,
    Field(discriminator="task_type"),
]
_MATERIAL_JOB_ADAPTER = TypeAdapter(MaterialJob)


def parse_material_job(body: bytes) -> MaterialJob:
    if not body or len(body) > MAX_MATERIAL_JOB_BYTES:
        raise ValueError("material job body must be between 1 byte and 64 KiB")
    return _MATERIAL_JOB_ADAPTER.validate_json(body)
