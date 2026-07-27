from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Literal, TypeAlias
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator


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


MaterialJob: TypeAlias = Annotated[
    PptxEmbedJob | EmbedDeleteJob,
    Field(discriminator="task_type"),
]
_MATERIAL_JOB_ADAPTER = TypeAdapter(MaterialJob)


def parse_material_job(body: bytes) -> MaterialJob:
    if not body or len(body) > MAX_MATERIAL_JOB_BYTES:
        raise ValueError("material job body must be between 1 byte and 64 KiB")
    return _MATERIAL_JOB_ADAPTER.validate_json(body)
