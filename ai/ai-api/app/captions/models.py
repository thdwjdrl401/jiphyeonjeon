from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator

MAX_NUMERIC_STRING_LENGTH = 18
SafeIdentifier = Annotated[
    str,
    Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),
]
CanonicalUuid = Annotated[
    str,
    Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
]
PositiveIntegerString = Annotated[
    str,
    Field(pattern=r"^[1-9][0-9]*$", max_length=MAX_NUMERIC_STRING_LENGTH),
]
NonNegativeIntegerString = Annotated[
    str,
    Field(pattern=r"^(0|[1-9][0-9]*)$", max_length=MAX_NUMERIC_STRING_LENGTH),
]


class _CaptionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=False)

    contractVersion: Literal["1"]
    eventId: SafeIdentifier
    sessionId: CanonicalUuid
    lessonId: CanonicalUuid
    sttSessionId: SafeIdentifier
    occurredAt: datetime

    @field_validator("occurredAt")
    @classmethod
    def validate_occurred_at(cls, value: datetime) -> datetime:
        if value.utcoffset() is None:
            raise ValueError("occurredAt must include a timezone offset")
        return value


class CaptionDelta(_CaptionModel):
    type: Literal["caption.delta"]
    sequence: PositiveIntegerString
    streamElapsedMs: NonNegativeIntegerString
    text: str = Field(min_length=1, max_length=10_000)


class CaptionCompleted(_CaptionModel):
    type: Literal["caption.stream.completed"]
    lastSequence: NonNegativeIntegerString
    streamElapsedMs: NonNegativeIntegerString
    reason: Literal["ROOM_DELETED"]


CaptionEntry = Annotated[CaptionDelta | CaptionCompleted, Field(discriminator="type")]
_CAPTION_ENTRY_ADAPTER = TypeAdapter(CaptionEntry)


def parse_caption_entry(payload: Mapping[Any, Any]) -> CaptionEntry:
    normalized: dict[str, str] = {}
    for raw_key, raw_value in payload.items():
        key = _decode_redis_string(raw_key)
        if key in normalized:
            raise ValueError("duplicate Redis caption field")
        normalized[key] = _decode_redis_string(raw_value)
    return _CAPTION_ENTRY_ADAPTER.validate_python(normalized)


def _decode_redis_string(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise ValueError("Redis caption fields must be strings")
