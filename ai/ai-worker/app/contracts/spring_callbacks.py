from __future__ import annotations

from typing import Literal, Self
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, model_validator


MaterialCallbackType = Literal[
    "MATERIAL_EMBEDDING",
    "MATERIAL_EMBEDDED",
    "MATERIAL_EMBED_FAILED",
    "MATERIAL_DELETED",
    "MATERIAL_DELETE_FAILED",
]
MaterialCallbackStatus = Literal["PROCESSING", "READY", "FAILED", "DELETED"]
_STATUS_BY_EVENT: dict[str, str] = {
    "MATERIAL_EMBEDDING": "PROCESSING",
    "MATERIAL_EMBEDDED": "READY",
    "MATERIAL_EMBED_FAILED": "FAILED",
    "MATERIAL_DELETED": "DELETED",
    "MATERIAL_DELETE_FAILED": "FAILED",
}
_KEY_TERMS_EVENT_TYPE: MaterialCallbackType = "MATERIAL_EMBEDDED"
_OUTPUT_EVENT_TYPES: frozenset[MaterialCallbackType] = frozenset(
    {"MATERIAL_EMBEDDED", "MATERIAL_EMBED_FAILED"}
)
_CALLBACK_EVENT_NAMESPACE = UUID("9bdc3985-1818-4c55-b084-2eaa0de6b050")

AnnotationCallbackType = Literal[
    "ANNOTATION_EMBEDDING",
    "ANNOTATION_EMBEDDED",
    "ANNOTATION_EMBED_FAILED",
]
AnnotationCallbackStatus = Literal["PROCESSING", "READY", "FAILED"]
_ANNOTATION_STATUS_BY_EVENT: dict[str, str] = {
    "ANNOTATION_EMBEDDING": "PROCESSING",
    "ANNOTATION_EMBEDDED": "READY",
    "ANNOTATION_EMBED_FAILED": "FAILED",
}


class KeyTermPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    term: str = Field(min_length=1)
    definition: str = Field(min_length=1)


KeyTermResultStatus = Literal["NOT_REQUESTED", "READY", "EMPTY", "FAILED"]


class KeyTermResultPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: KeyTermResultStatus
    count: int = Field(ge=0)
    truncated: bool = False
    failure_code: str | None = Field(default=None, alias="failureCode", max_length=128)

    @model_validator(mode="after")
    def validate_result_shape(self) -> Self:
        if self.status == "READY" and self.count < 1:
            raise ValueError("READY key-term result requires a positive count")
        if self.status != "READY" and self.count != 0:
            raise ValueError("only READY key-term result may have a positive count")
        if self.status == "FAILED" and self.failure_code is None:
            raise ValueError("FAILED key-term result requires failureCode")
        if self.status != "FAILED" and self.failure_code is not None:
            raise ValueError("only FAILED key-term result may have failureCode")
        return self


class MaterialCallbackOutputs(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    material_version_id: int | None = Field(default=None, alias="materialVersionId", ge=1)
    chunk_count: int | None = Field(default=None, alias="chunkCount", ge=0)
    key_term_result: KeyTermResultPayload = Field(alias="keyTermResult")


class MaterialCallbackEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    event_id: UUID = Field(alias="eventId")
    event_type: MaterialCallbackType = Field(alias="eventType")
    job_id: str = Field(alias="jobId", min_length=1, max_length=128)
    material_id: UUID = Field(alias="materialId")
    lesson_id: UUID = Field(alias="lessonId")
    status: MaterialCallbackStatus
    key_terms: tuple[KeyTermPayload, ...] | None = Field(default=None, alias="keyTerms")
    outputs: MaterialCallbackOutputs | None = None

    @model_validator(mode="after")
    def validate_status_matches_event(self) -> Self:
        if _STATUS_BY_EVENT[self.event_type] != self.status:
            raise ValueError("callback status must match eventType")
        return self

    @model_validator(mode="after")
    def validate_key_terms_scoped_to_its_event_type(self) -> Self:
        if self.key_terms is not None and self.event_type != _KEY_TERMS_EVENT_TYPE:
            raise ValueError(f"keyTerms may only be present on {_KEY_TERMS_EVENT_TYPE}")
        return self

    @model_validator(mode="after")
    def validate_outputs_scoped_to_embedding_success(self) -> Self:
        if self.outputs is not None and self.event_type not in _OUTPUT_EVENT_TYPES:
            raise ValueError("outputs may only be present on embedding terminal events")
        return self

    def raw_body(self) -> bytes:
        return self.model_dump_json(by_alias=True, exclude_none=True).encode("utf-8")


class AnnotationCallbackEvent(BaseModel):
    """Result of one annotation highlight job (ADR-0074 결정 1).

    Same endpoint, HMAC and eventId idempotency as the material callback, but keyed by
    `highlightId` — Spring settles `core.annotation_highlight.index_status` from that alone,
    so nothing else is echoed back. Like MATERIAL_EMBEDDING, the PROCESSING type exists in the
    contract but the worker only sends terminal events (see CONTRACT.md §11.3).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    event_id: UUID = Field(alias="eventId")
    event_type: AnnotationCallbackType = Field(alias="eventType")
    job_id: str = Field(alias="jobId", min_length=1, max_length=128)
    highlight_id: UUID = Field(alias="highlightId")
    status: AnnotationCallbackStatus

    @model_validator(mode="after")
    def validate_status_matches_event(self) -> Self:
        if _ANNOTATION_STATUS_BY_EVENT[self.event_type] != self.status:
            raise ValueError("callback status must match eventType")
        return self

    def raw_body(self) -> bytes:
        return self.model_dump_json(by_alias=True, exclude_none=True).encode("utf-8")


def material_callback_event_id(job_id: str, event_type: MaterialCallbackType) -> UUID:
    return _callback_event_id(job_id, event_type)


def annotation_callback_event_id(job_id: str, event_type: AnnotationCallbackType) -> UUID:
    return _callback_event_id(job_id, event_type)


def _callback_event_id(job_id: str, event_type: str) -> UUID:
    if not job_id or not job_id.strip() or job_id != job_id.strip():
        raise ValueError("job_id must not be blank or padded")
    return uuid5(_CALLBACK_EVENT_NAMESPACE, f"{job_id}:{event_type}")
