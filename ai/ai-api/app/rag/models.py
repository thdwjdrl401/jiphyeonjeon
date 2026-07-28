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
    sessionId: SessionId
    question: Question
    contextTimeMs: int = Field(ge=0)
    issuedAtMs: int = Field(ge=0)


class PptxSource(_ContractModel):
    type: Literal["PPTX"] = "PPTX"
    materialId: UUID
    page: int = Field(ge=1)


class CaptionSource(_ContractModel):
    type: Literal["CAPTION"] = "CAPTION"
    sessionId: SessionId
    sttSessionId: SafeIdentifier
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)

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
    """Prompt-ready excerpt with the scope key its source can prove."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=False)

    lesson_id: UUID
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
