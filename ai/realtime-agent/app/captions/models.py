from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

MAX_CONTRACT_INTEGER = 10**18 - 1
MAX_CAPTION_TEXT_LENGTH = 10_000
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _validate_integer(value: int, field_name: str, *, minimum: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{field_name} must be an integer")
    if not minimum <= value <= MAX_CONTRACT_INTEGER:
        raise ValueError(f"{field_name} must be between {minimum} and {MAX_CONTRACT_INTEGER}")


def _validate_identifier(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"{field_name} must be a 1-128 character safe identifier")


def _validate_uuid(value: UUID, field_name: str) -> None:
    if not isinstance(value, UUID):
        raise TypeError(f"{field_name} must be a UUID")


def _validate_occurred_at(value: datetime) -> None:
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError("occurred_at must be a timezone-aware datetime")


@dataclass(frozen=True, slots=True)
class CaptionDelta:
    event_id: str
    session_id: UUID
    lesson_id: UUID
    stt_session_id: str
    sequence: int
    stream_elapsed_ms: int
    text: str
    occurred_at: datetime
    contract_version: str = "1"

    def __post_init__(self) -> None:
        if self.contract_version != "1":
            raise ValueError("contract_version must be '1'")
        _validate_identifier(self.event_id, "event_id")
        _validate_uuid(self.session_id, "session_id")
        _validate_uuid(self.lesson_id, "lesson_id")
        _validate_identifier(self.stt_session_id, "stt_session_id")
        _validate_integer(self.sequence, "sequence", minimum=1)
        _validate_integer(self.stream_elapsed_ms, "stream_elapsed_ms", minimum=0)
        if not isinstance(self.text, str):
            raise TypeError("text must be a string")
        if not self.text:
            raise ValueError("text must not be empty")
        if len(self.text) > MAX_CAPTION_TEXT_LENGTH:
            raise ValueError(f"text must not exceed {MAX_CAPTION_TEXT_LENGTH} characters")
        _validate_occurred_at(self.occurred_at)

    @property
    def type(self) -> str:
        return "caption.delta"


@dataclass(frozen=True, slots=True)
class CaptionStreamCompleted:
    event_id: str
    session_id: UUID
    lesson_id: UUID
    stt_session_id: str
    last_sequence: int
    stream_elapsed_ms: int
    reason: str
    occurred_at: datetime
    contract_version: str = "1"

    def __post_init__(self) -> None:
        if self.contract_version != "1":
            raise ValueError("contract_version must be '1'")
        _validate_identifier(self.event_id, "event_id")
        _validate_uuid(self.session_id, "session_id")
        _validate_uuid(self.lesson_id, "lesson_id")
        _validate_identifier(self.stt_session_id, "stt_session_id")
        _validate_integer(self.last_sequence, "last_sequence", minimum=0)
        _validate_integer(self.stream_elapsed_ms, "stream_elapsed_ms", minimum=0)
        if self.reason != "ROOM_DELETED":
            raise ValueError("reason must be 'ROOM_DELETED'")
        _validate_occurred_at(self.occurred_at)

    @property
    def type(self) -> str:
        return "caption.stream.completed"
