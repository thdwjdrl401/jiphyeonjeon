from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.captions.models import (
    CanonicalUuid,
    NonNegativeIntegerString,
    PositiveIntegerString,
    SafeIdentifier,
)


class WindowFlushReason(StrEnum):
    STRONG_BOUNDARY = "strong_boundary"
    TARGET_REACHED = "target_reached"
    FORCED_THRESHOLD = "forced_threshold"
    ATTEMPT_CHANGED = "attempt_changed"
    COMPLETED = "completed"


class TopicAction(StrEnum):
    CONTINUE = "CONTINUE"
    START_NEW = "START_NEW"


class LectureNoteDecisionAction(StrEnum):
    IGNORE = "IGNORE"
    APPEND = "APPEND"
    START_NEW = "START_NEW"


InlineText = Annotated[str, Field(min_length=1, max_length=300)]


class LectureNoteModelResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    action: LectureNoteDecisionAction
    topicTitle: str | None = Field(default=None, min_length=1, max_length=80)
    keyPoints: tuple[InlineText, ...] = Field(default=(), max_length=3)

    @field_validator("topicTitle")
    @classmethod
    def validate_topic_title(cls, value: str | None) -> str | None:
        return None if value is None else _validate_single_line(value, "topicTitle")

    @field_validator("keyPoints")
    @classmethod
    def validate_key_points(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(_validate_single_line(value, "keyPoints") for value in values)

    @model_validator(mode="after")
    def validate_action_payload(self) -> LectureNoteModelResult:
        if self.action is LectureNoteDecisionAction.IGNORE:
            if self.topicTitle is not None or self.keyPoints:
                raise ValueError("IGNORE must not include topicTitle or keyPoints")
            return self
        if self.topicTitle is None or not self.keyPoints:
            raise ValueError("APPEND and START_NEW require topicTitle and keyPoints")
        return self


@dataclass(frozen=True, slots=True)
class LectureNoteModelRequest:
    session_id: str
    lesson_id: str
    stt_session_id: str
    current_topic_title: str | None
    current_key_points: tuple[str, ...]
    previous_topic_title: str | None
    previous_context: str
    text: str


class _LectureNoteTopicContent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    topicTitle: str = Field(min_length=1, max_length=80)
    keyPoints: tuple[InlineText, ...] = Field(min_length=1, max_length=20)

    @field_validator("topicTitle")
    @classmethod
    def validate_topic_title(cls, value: str) -> str:
        return _validate_single_line(value, "topicTitle")

    @field_validator("keyPoints")
    @classmethod
    def validate_key_points(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(_validate_single_line(value, "keyPoints") for value in values)


class LectureNoteRefinementTopic(_LectureNoteTopicContent):
    """종료 후 정제 모델이 반환하는 topic 내용."""


class LectureNoteRefinementResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    topics: tuple[LectureNoteRefinementTopic, ...] = Field(min_length=1, max_length=30)


@dataclass(frozen=True, slots=True)
class LectureNoteRefinementRequest:
    session_id: str
    lesson_id: str
    note: LectureNote


class _LectureNoteEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=False)

    contractVersion: Literal["1"] = "1"
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


class LectureNoteChunkAppended(_LectureNoteEvent):
    type: Literal["lecture.note.chunk.appended"] = "lecture.note.chunk.appended"
    chunkSequence: PositiveIntegerString
    latestSttSequence: PositiveIntegerString
    topicAction: TopicAction
    topicId: SafeIdentifier
    topicTitle: str = Field(min_length=1, max_length=80)
    keyPoints: tuple[InlineText, ...] = Field(min_length=1, max_length=3)
    markdownFragment: str = Field(min_length=1, max_length=8_192)


class LectureNoteCaptureCompleted(_LectureNoteEvent):
    type: Literal["lecture.note.capture.completed"] = "lecture.note.capture.completed"
    lastChunkSequence: NonNegativeIntegerString
    lastSttSequence: NonNegativeIntegerString
    reason: Literal["ROOM_DELETED"]


class LectureNoteRefinedTopic(_LectureNoteTopicContent):
    topicId: SafeIdentifier


class LectureNoteRefinedSnapshot(_LectureNoteEvent):
    type: Literal["lecture.note.refined.snapshot"] = "lecture.note.refined.snapshot"
    sourceLastChunkSequence: PositiveIntegerString
    topics: tuple[LectureNoteRefinedTopic, ...] = Field(min_length=1, max_length=30)
    markdownSnapshot: str = Field(min_length=1, max_length=262_144)


LectureNoteEvent: TypeAlias = (
    LectureNoteChunkAppended | LectureNoteCaptureCompleted | LectureNoteRefinedSnapshot
)


@dataclass(frozen=True, slots=True)
class LectureNoteWindow:
    session_id: str
    lesson_id: str
    stt_session_id: str
    start_sequence: int
    end_sequence: int
    start_stream_elapsed_ms: int
    end_stream_elapsed_ms: int
    text: str
    previous_context: str
    flush_reason: WindowFlushReason


@dataclass(frozen=True, slots=True)
class LectureNoteTopic:
    topic_id: str
    title: str
    key_points: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class LectureNote:
    topics: tuple[LectureNoteTopic, ...] = ()
    chunk_sequence: int = 0


def _validate_single_line(value: str, field_name: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError(f"{field_name} must be a single line")
    return value
