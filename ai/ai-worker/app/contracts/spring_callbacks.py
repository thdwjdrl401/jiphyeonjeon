from __future__ import annotations

from typing import Literal, Self
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, model_validator


MaterialCallbackType = Literal[
    "MATERIAL_EMBEDDING",
    "MATERIAL_EMBEDDED",
    "MATERIAL_EMBED_FAILED",
    "MATERIAL_KEY_TERMS_EXTRACTED",
]
MaterialCallbackStatus = Literal["PROCESSING", "READY", "FAILED"]
_STATUS_BY_EVENT: dict[str, str] = {
    "MATERIAL_EMBEDDING": "PROCESSING",
    "MATERIAL_EMBEDDED": "READY",
    "MATERIAL_EMBED_FAILED": "FAILED",
    "MATERIAL_KEY_TERMS_EXTRACTED": "READY",
}
_CALLBACK_EVENT_NAMESPACE = UUID("9bdc3985-1818-4c55-b084-2eaa0de6b050")


class KeyTermPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    term: str = Field(min_length=1)
    definition: str = Field(min_length=1)


class MaterialCallbackEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    event_id: UUID = Field(alias="eventId")
    event_type: MaterialCallbackType = Field(alias="eventType")
    job_id: str = Field(alias="jobId", min_length=1, max_length=128)
    material_id: UUID = Field(alias="materialId")
    lesson_id: UUID = Field(alias="lessonId")
    status: MaterialCallbackStatus
    key_terms: tuple[KeyTermPayload, ...] | None = Field(default=None, alias="keyTerms")

    @model_validator(mode="after")
    def validate_status_matches_event(self) -> Self:
        if _STATUS_BY_EVENT[self.event_type] != self.status:
            raise ValueError("callback status must match eventType")
        return self

    @model_validator(mode="after")
    def validate_key_terms_scoped_to_its_event_type(self) -> Self:
        if (self.event_type == "MATERIAL_KEY_TERMS_EXTRACTED") != (self.key_terms is not None):
            raise ValueError(
                "keyTerms is required for and exclusive to MATERIAL_KEY_TERMS_EXTRACTED"
            )
        return self

    def raw_body(self) -> bytes:
        return self.model_dump_json(by_alias=True, exclude_none=True).encode("utf-8")


def material_callback_event_id(job_id: str, event_type: MaterialCallbackType) -> UUID:
    if not job_id or not job_id.strip() or job_id != job_id.strip():
        raise ValueError("job_id must not be blank or padded")
    return uuid5(_CALLBACK_EVENT_NAMESPACE, f"{job_id}:{event_type}")
