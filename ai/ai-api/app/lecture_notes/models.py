from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
import re
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


class LectureNoteDraftUpdateAction(StrEnum):
    """활성 topic 전체를 갱신하는 contract v2 내부 판단."""

    IGNORE = "IGNORE"
    UPDATE_CURRENT = "UPDATE_CURRENT"
    START_NEW = "START_NEW"


class LectureNoteTopicStatus(StrEnum):
    ACTIVE = "ACTIVE"
    FINALIZED = "FINALIZED"


class LectureNoteDraftItemType(StrEnum):
    DEFINITION = "DEFINITION"
    FACT = "FACT"
    MECHANISM = "MECHANISM"
    PROCEDURE = "PROCEDURE"
    EXAMPLE = "EXAMPLE"
    CAUTION = "CAUTION"


InlineText = Annotated[str, Field(min_length=1, max_length=300)]
TopicOverview = Annotated[str, Field(min_length=1, max_length=2_000)]
_SENTENCE_BOUNDARY = re.compile(r"[.!?。？！]+[\"'’”」』)]*(?:\s+|$)")
_PROSE_SENTENCE_END = re.compile(
    r"(?:니다|해요|돼요|예요|이에요|한다|된다|했다|였다|있다|없다|같다|아니다)$"
)


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


class LectureNoteDraftItem(BaseModel):
    """중요도 대신 강의 정보의 역할을 표현하는 topic 내부 항목."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    type: LectureNoteDraftItemType
    label: str | None = Field(default=None, min_length=1, max_length=80)
    content: InlineText

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: str | None) -> str | None:
        return None if value is None else _validate_single_line(value, "item label")

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        return _validate_single_line(value, "item content")

    @model_validator(mode="after")
    def validate_definition_label(self) -> LectureNoteDraftItem:
        if self.type is LectureNoteDraftItemType.DEFINITION and self.label is None:
            raise ValueError("DEFINITION requires a label")
        return self


class LectureNoteDraftTopicContent(BaseModel):
    """모델이 반환하는 topic 내용이며 ID와 revision은 애플리케이션이 관리한다."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    topicTitle: str = Field(min_length=2, max_length=80)
    overview: TopicOverview
    items: tuple[LectureNoteDraftItem, ...] = Field(min_length=1, max_length=12)

    @field_validator("topicTitle")
    @classmethod
    def validate_topic_title(cls, value: str) -> str:
        return _validate_single_line(value, "topic title")

    @field_validator("overview")
    @classmethod
    def validate_overview(cls, value: str) -> str:
        return _validate_nominal_note_style(_validate_single_line(value, "topic overview"))

    @model_validator(mode="after")
    def validate_item_note_style(self) -> LectureNoteDraftTopicContent:
        for item in self.items:
            _validate_nominal_note_style(item.content)
        return self


class LectureNoteDraftUpdateResult(BaseModel):
    """한 번의 모델 호출로 현재 topic 갱신 또는 topic 전환을 표현한다."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    action: LectureNoteDraftUpdateAction
    currentTopic: LectureNoteDraftTopicContent | None = None
    newTopic: LectureNoteDraftTopicContent | None = None

    @model_validator(mode="after")
    def validate_action_payload(self) -> LectureNoteDraftUpdateResult:
        if self.action is LectureNoteDraftUpdateAction.IGNORE:
            if self.currentTopic is not None or self.newTopic is not None:
                raise ValueError("IGNORE must not include topic content")
            return self
        if self.action is LectureNoteDraftUpdateAction.UPDATE_CURRENT:
            if self.currentTopic is None or self.newTopic is not None:
                raise ValueError("UPDATE_CURRENT requires only currentTopic")
            return self
        if self.newTopic is None:
            raise ValueError("START_NEW requires newTopic")
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


@dataclass(frozen=True, slots=True)
class LectureNoteDraftModelRequest:
    session_id: str
    lesson_id: str
    stt_session_id: str
    note: LectureNoteDraft
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


@dataclass(frozen=True, slots=True)
class LectureNoteDraftTopic:
    topic_id: str
    revision: int
    status: LectureNoteTopicStatus
    title: str
    overview: str
    items: tuple[LectureNoteDraftItem, ...]

    def __post_init__(self) -> None:
        if not self.topic_id:
            raise ValueError("topic_id must not be empty")
        if self.revision <= 0:
            raise ValueError("topic revision must be positive")
        _validate_single_line(self.title, "title")
        _validate_single_line(self.overview, "overview")
        # 신규 모델 응답은 2자 이상이지만, 1자 제목을 허용하던 구 checkpoint는 보존한다.
        if not 1 <= len(self.title) <= 80:
            raise ValueError("title length must be between 1 and 80")
        if not 1 <= len(self.overview) <= 2_000:
            raise ValueError("overview length must be between 1 and 2000")
        if not 1 <= len(self.items) <= 12:
            raise ValueError("items must contain between 1 and 12 entries")


@dataclass(frozen=True, slots=True)
class LectureNoteDraft:
    topics: tuple[LectureNoteDraftTopic, ...] = ()
    update_sequence: int = 0

    def __post_init__(self) -> None:
        if self.update_sequence < 0:
            raise ValueError("update_sequence must be non-negative")
        active_indexes = [
            index
            for index, topic in enumerate(self.topics)
            if topic.status is LectureNoteTopicStatus.ACTIVE
        ]
        if len(active_indexes) > 1:
            raise ValueError("lecture note draft must have at most one active topic")
        if active_indexes and active_indexes[0] != len(self.topics) - 1:
            raise ValueError("active topic must be the last topic")


def _validate_single_line(value: str, field_name: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError(f"{field_name} must be a single line")
    return value


def uses_nominal_note_style(value: str) -> bool:
    # 자연스러운 명사구를 허용하기 위한 휴리스틱이며 완전한 한국어 품사 판별은 아님.
    sentences = tuple(
        sentence.strip() for sentence in _SENTENCE_BOUNDARY.split(value.strip()) if sentence.strip()
    )
    return bool(sentences) and all(
        _PROSE_SENTENCE_END.search(sentence) is None for sentence in sentences
    )


def _validate_nominal_note_style(value: str) -> str:
    if not uses_nominal_note_style(value):
        raise ValueError("note text must use concise nominal sentence endings")
    return value
