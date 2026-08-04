"""Wire contracts for every job Spring publishes to the shared `ingestion.embed` queue.

PPTX material jobs and annotation highlight jobs (ADR-0074) travel the same queue and are
discriminated by `taskType`, so one parser owns the whole union.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Literal, TypeAlias
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, TypeAdapter, model_validator


MAX_MATERIAL_JOB_BYTES = 64 * 1024


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
    extract_key_terms: bool | None = Field(default=None, alias="extractKeyTerms")


# Materials attach at two levels (docs/ai/CONTRACT.md §9). Spring omits `scope` entirely on
# lesson jobs — "LESSON" is accepted for symmetry but never actually sent today.
MaterialScopeName = Literal["CURRICULUM", "LESSON"]


def _validate_scope_pair(scope: MaterialScopeName | None, lesson_id: UUID | None) -> None:
    """A job's scope and its lesson must agree, in both directions.

    Curriculum materials have no lesson, so a lessonId alongside CURRICULUM is a contradiction
    rather than extra information. And a lesson job that lost its lessonId would silently
    become curriculum-wide — indexing it for the whole curriculum instead of one lesson — so
    the absent case has to fail too.
    """

    if scope == "CURRICULUM":
        if lesson_id is not None:
            raise ValueError("curriculum-scoped jobs must not carry lessonId")
    elif lesson_id is None:
        raise ValueError("lesson-scoped jobs require lessonId")


class PptxEmbedJob(_WireModel):
    task_type: Literal["PPTX_EMBED"] = Field(alias="taskType")
    scope: MaterialScopeName | None = None
    material_id: UUID = Field(alias="materialId")
    asset_id: UUID = Field(alias="assetId")
    lesson_id: UUID | None = Field(default=None, alias="lessonId")
    curriculum_id: UUID = Field(alias="curriculumId")
    file_name: str = Field(alias="fileName", max_length=1_024)
    policy: EmbedPolicy
    contract_version: Literal[1, 2] = Field(alias="contractVersion")

    @model_validator(mode="after")
    def validate_policy_matches_contract_version(self) -> PptxEmbedJob:
        if self.contract_version == 1 and self.policy.extract_key_terms is not None:
            raise ValueError("v1 PPTX_EMBED must use the worker key-term default")
        if self.contract_version == 2 and self.policy.extract_key_terms is None:
            raise ValueError("v2 PPTX_EMBED requires policy.extractKeyTerms")
        return self

    @model_validator(mode="after")
    def validate_scope_pair(self) -> PptxEmbedJob:
        _validate_scope_pair(self.scope, self.lesson_id)
        return self


class EmbedDeleteJob(_WireModel):
    """Delete envelopes are asymmetric by scope and both shapes must be accepted as-is.

    The lesson one carries `lessonId` and no `curriculumId`; the curriculum one is the exact
    opposite. Rejecting either sends real Spring traffic to the DLQ.
    """

    task_type: Literal["EMBED_DELETE"] = Field(alias="taskType")
    scope: MaterialScopeName | None = None
    material_id: UUID = Field(alias="materialId")
    lesson_id: UUID | None = Field(default=None, alias="lessonId")
    curriculum_id: UUID | None = Field(default=None, alias="curriculumId")
    contract_version: Literal[1] = Field(alias="contractVersion")

    @model_validator(mode="after")
    def validate_scope_pair(self) -> EmbedDeleteJob:
        _validate_scope_pair(self.scope, self.lesson_id)
        return self


class AnnotationEmbedJob(_WireModel):
    """One instructor highlight to index as timeline-anchored evidence (ADR-0074 결정 1).

    `text` is the body: Spring reads the highlight crop with its own vision model and sends the
    result. No image and no `assetId` reach the worker — the read already happened, and doing
    it twice would split what the instructor confirmed on screen from what the answer cites.

    The worker therefore indexes this text unverified. The instructor confirmation step on the
    Spring side is the only gate protecting the evidence index.
    """

    task_type: Literal["ANNOTATION_EMBED"] = Field(alias="taskType")
    highlight_id: UUID = Field(alias="highlightId")
    session_id: UUID = Field(alias="sessionId")
    lesson_id: UUID = Field(alias="lessonId")
    curriculum_id: UUID = Field(alias="curriculumId")
    session_ms: int = Field(alias="sessionMs", ge=0)
    captured_at: AwareDatetime = Field(alias="capturedAt")
    # No length cap. Nothing upstream enforces one — Spring stores the vision output in an
    # unbounded `text` column — and rejecting here sent the job to the DLQ with no callback,
    # so the instructor waited on PROCESSING forever. The 64 KiB envelope is the real bound.
    text: str = Field(min_length=1)
    policy: EmbedPolicy
    contract_version: Literal[1] = Field(alias="contractVersion")

    @model_validator(mode="after")
    def reject_blank_text(self) -> AnnotationEmbedJob:
        # A blank description would sit in the index matching nothing. Better to DLQ it than
        # to let Spring believe the highlight became searchable evidence.
        if not self.text.strip():
            raise ValueError("annotation text must not be blank")
        return self


class AnnotationEmbedDeleteJob(_WireModel):
    """Remove one highlight from the evidence index (ADR-0074 결정 2).

    Unrelated to erasing the stroke: a highlight capture records a moment, so its lifetime is
    decoupled from the annotation element it came from.
    """

    task_type: Literal["ANNOTATION_EMBED_DELETE"] = Field(alias="taskType")
    highlight_id: UUID = Field(alias="highlightId")
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
