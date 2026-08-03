from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128)]
SafeIdentifier = Annotated[
    str,
    Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),
]
SessionId = Annotated[
    str,
    Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
]
Question = Annotated[str, Field(min_length=1, max_length=4_000)]
Message = Annotated[str, Field(min_length=1, max_length=1_000)]
ErrorCode = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]{0,127}$")]


class _ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=False)


class RagAnswerRequest(_ContractModel):
    requestId: Identifier
    lessonId: UUID
    curriculumId: UUID
    sessionId: SessionId
    question: Question
    contextTimeMs: int = Field(ge=0)
    issuedAtMs: int = Field(ge=0)
    # Optional and additive (ADR-0010): Spring does not send these yet. Both must be present
    # for conversation memory to activate — omit either and this request behaves exactly as
    # before (no previous_response_id lookup, no response id saved).
    userId: Identifier | None = None
    conversationId: Identifier | None = None


class PptxSource(_ContractModel):
    type: Literal["PPTX"] = "PPTX"
    materialId: UUID
    page: int = Field(ge=1)
    excerpt: str | None = Field(default=None, max_length=1000)


class CaptionSource(_ContractModel):
    type: Literal["CAPTION"] = "CAPTION"
    sessionId: SessionId
    sttSessionId: SafeIdentifier
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    excerpt: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_time_range(self) -> CaptionSource:
        if self.endMs < self.startMs:
            raise ValueError("caption source endMs must be greater than or equal to startMs")
        return self


AnswerSource = Annotated[PptxSource | CaptionSource, Field(discriminator="type")]


class AnswerDeltaData(_ContractModel):
    requestId: Identifier
    text: str = Field(min_length=1, max_length=10_000)


class AnswerDelta(_ContractModel):
    event: Literal["answer.delta"] = "answer.delta"
    data: AnswerDeltaData


class AnswerDoneData(_ContractModel):
    requestId: Identifier
    sources: tuple[AnswerSource, ...] = Field(min_length=1)


class AnswerDone(_ContractModel):
    event: Literal["answer.done"] = "answer.done"
    data: AnswerDoneData


class AnswerInsufficientData(_ContractModel):
    requestId: Identifier
    message: Message


class AnswerInsufficient(_ContractModel):
    event: Literal["answer.insufficient"] = "answer.insufficient"
    data: AnswerInsufficientData


class AnswerErrorData(_ContractModel):
    requestId: Identifier
    code: ErrorCode
    message: Message
    retryable: bool


class AnswerError(_ContractModel):
    event: Literal["answer.error"] = "answer.error"
    data: AnswerErrorData


AnswerEvent = AnswerDelta | AnswerDone | AnswerInsufficient | AnswerError


class RetrievedEvidence(BaseModel):
    """Prompt-ready excerpt with the scope key its source can prove.

    curriculum_id is the PptxSource scope key (materials are shared curriculum-wide,
    ADR-0007) and is None for CaptionSource, which stays lesson_id/sessionId-scoped.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=False)

    lesson_id: UUID
    curriculum_id: UUID | None = None
    content: str = Field(min_length=1, max_length=50_000)
    source: AnswerSource


class RetrievalResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    sufficient: bool
    evidence: tuple[RetrievedEvidence, ...] = Field(default=(), max_length=100)

    @model_validator(mode="after")
    def validate_sufficient_evidence(self) -> RetrievalResult:
        if self.sufficient and not self.evidence:
            raise ValueError("sufficient retrieval result must contain evidence")
        return self


# --- Replay (v2) models -----------------------------------------------------
# ADR-0037 / docs/decisions/jinwoo/0008-replay-rag-answer-v2-endpoint.md.
# v1 models above stay untouched; these are a parallel schema set for
# /internal/v2/rag/answers:stream.

SttSessionId = Annotated[str, Field(min_length=1, max_length=128)]


_CAPTIONS_TOTAL_CHAR_BUDGET = 6_000


class CaptionContextItem(_ContractModel):
    sttSessionId: SttSessionId
    segmentIndex: int = Field(ge=0)
    startSessionMs: int = Field(ge=0)
    endSessionMs: int = Field(ge=0)
    # No per-item cap in ADR-0037 — only the aggregate 6,000-char budget below. This ceiling
    # exists purely so one item can never exceed what the aggregate rule would allow anyway.
    text: str = Field(min_length=1, max_length=_CAPTIONS_TOTAL_CHAR_BUDGET)

    @model_validator(mode="after")
    def validate_time_range(self) -> CaptionContextItem:
        if self.endSessionMs < self.startSessionMs:
            raise ValueError("caption context item endSessionMs must be >= startSessionMs")
        return self


class ReplayContext(_ContractModel):
    mode: Literal["REPLAY"] = "REPLAY"
    questionSessionMs: int = Field(ge=0)
    captions: tuple[CaptionContextItem, ...] = Field(default=(), max_length=20)

    @model_validator(mode="after")
    def validate_captions_char_budget(self) -> ReplayContext:
        # ADR-0037: "최대 20개 발화, text 합계 최대 6,000자" — max_length=20 above covers the
        # item count; this covers the aggregate character budget across all items.
        total_chars = sum(len(item.text) for item in self.captions)
        if total_chars > _CAPTIONS_TOTAL_CHAR_BUDGET:
            raise ValueError(
                f"captions text length must not exceed {_CAPTIONS_TOTAL_CHAR_BUDGET} characters in total"
            )
        return self


class RagAnswerRequestV2(_ContractModel):
    requestId: Identifier
    lessonId: UUID
    curriculumId: UUID
    sessionId: SessionId
    question: Question
    context: ReplayContext
    issuedAtMs: int = Field(ge=0)


class PptxSourceV2(_ContractModel):
    """PPTX source with the plain-text excerpt ADR-0037 requires. v1 PptxSource is unchanged."""

    type: Literal["PPTX"] = "PPTX"
    materialId: UUID
    page: int = Field(ge=1)
    excerpt: str = Field(min_length=1, max_length=300)


class CaptionSourceV2(_ContractModel):
    """Replay caption source. Deliberately excludes sttSessionId (present on v1 CaptionSource)
    to match the ADR-0037 answer.done.sources CAPTION example exactly."""

    type: Literal["CAPTION"] = "CAPTION"
    sessionId: SessionId
    startSessionMs: int = Field(ge=0)
    endSessionMs: int = Field(ge=0)
    excerpt: str = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def validate_time_range(self) -> CaptionSourceV2:
        if self.endSessionMs < self.startSessionMs:
            raise ValueError("caption source endSessionMs must be >= startSessionMs")
        return self


AnswerSourceV2 = Annotated[PptxSourceV2 | CaptionSourceV2, Field(discriminator="type")]


class AnswerDoneDataV2(_ContractModel):
    requestId: Identifier
    sources: tuple[AnswerSourceV2, ...] = Field(min_length=1)


class AnswerDoneV2(_ContractModel):
    event: Literal["answer.done"] = "answer.done"
    data: AnswerDoneDataV2


AnswerEventV2 = AnswerDelta | AnswerDoneV2 | AnswerInsufficient | AnswerError


class RetrievedEvidenceV2(BaseModel):
    """Same shape as RetrievedEvidence but source already carries its excerpt."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=False)

    lesson_id: UUID
    curriculum_id: UUID | None = None
    content: str = Field(min_length=1, max_length=50_000)
    source: AnswerSourceV2


class RetrievalResultV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    sufficient: bool
    evidence: tuple[RetrievedEvidenceV2, ...] = Field(default=(), max_length=100)

    @model_validator(mode="after")
    def validate_sufficient_evidence(self) -> RetrievalResultV2:
        if self.sufficient and not self.evidence:
            raise ValueError("sufficient retrieval result must contain evidence")
        return self
