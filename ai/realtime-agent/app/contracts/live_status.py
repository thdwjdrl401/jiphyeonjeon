from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast
from uuid import UUID

LiveAgentState = Literal[
    "ROOM_CONNECTED",
    "STT_STARTED",
    "AUDIO_STARTED",
    "STOPPING",
    "SUCCEEDED",
    "FAILED",
]
TERMINAL_STATES = frozenset({"SUCCEEDED", "FAILED"})
_STATES = frozenset(
    {
        "ROOM_CONNECTED",
        "STT_STARTED",
        "AUDIO_STARTED",
        "STOPPING",
        "SUCCEEDED",
        "FAILED",
    }
)
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def parse_state(value: str) -> LiveAgentState:
    if value not in _STATES:
        raise ValueError(f"unsupported live agent state: {value}")
    return cast(LiveAgentState, value)


def _validate_identifier(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"{field_name} must be a 1-128 character safe identifier")


@dataclass(frozen=True, slots=True)
class LiveAgentError:
    code: str
    message: str
    retryable: bool

    def __post_init__(self) -> None:
        _validate_identifier(self.code, "error.code")
        if not isinstance(self.message, str) or not 1 <= len(self.message) <= 1000:
            raise ValueError("error.message must contain 1-1000 characters")
        if not isinstance(self.retryable, bool):
            raise TypeError("error.retryable must be a boolean")


@dataclass(frozen=True, slots=True)
class LiveAgentStatusEvent:
    event_id: str
    session_id: UUID
    lesson_id: UUID
    job_id: str
    state: LiveAgentState
    occurred_at: datetime
    error: LiveAgentError | None = None
    contract_version: str = "1"

    def __post_init__(self) -> None:
        if self.contract_version != "1":
            raise ValueError("contract_version must be '1'")
        _validate_identifier(self.event_id, "event_id")
        if not isinstance(self.session_id, UUID):
            raise TypeError("session_id must be a UUID")
        if not isinstance(self.lesson_id, UUID):
            raise TypeError("lesson_id must be a UUID")
        _validate_identifier(self.job_id, "job_id")
        parse_state(self.state)
        if not isinstance(self.occurred_at, datetime) or self.occurred_at.utcoffset() is None:
            raise ValueError("occurred_at must be a timezone-aware datetime")
        if self.state == "FAILED" and self.error is None:
            raise ValueError("FAILED lifecycle state requires error")
        if self.state != "FAILED" and self.error is not None:
            raise ValueError("error is only allowed for FAILED lifecycle state")

    @property
    def event_type(self) -> str:
        return "LIVE_AGENT_STATUS"
