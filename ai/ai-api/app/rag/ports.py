from collections.abc import AsyncIterator, Sequence
from typing import Protocol

from app.rag.models import (
    RagAnswerRequest,
    RagAnswerRequestV2,
    RetrievedEvidence,
    RetrievedEvidenceV2,
    RetrievalResult,
    RetrievalResultV2,
)


class EvidenceRetriever(Protocol):
    async def retrieve(self, request: RagAnswerRequest) -> RetrievalResult: ...


class ResponseIdCapture:
    """Mutable single-slot box an AnswerModel writes its GMS Responses API response id into
    while streaming (ADR-0010). Callers must create one fresh instance per request — AnswerModel
    implementations are long-lived singletons shared across concurrent requests, so this must
    never be stored as instance state on the model itself."""

    def __init__(self) -> None:
        self.value: str | None = None


class ConversationMemoryPort(Protocol):
    async def get_previous_response_id(
        self, *, user_id: str, session_id: str, conversation_id: str
    ) -> str | None: ...

    async def save_response_id(
        self, *, user_id: str, session_id: str, conversation_id: str, response_id: str
    ) -> None: ...


class AnswerModel(Protocol):
    def stream_answer(
        self,
        request: RagAnswerRequest,
        evidence: Sequence[RetrievedEvidence],
        *,
        previous_response_id: str | None = None,
        response_id_capture: ResponseIdCapture | None = None,
    ) -> AsyncIterator[str]: ...


class EvidenceRetrieverV2(Protocol):
    async def retrieve(self, request: RagAnswerRequestV2) -> RetrievalResultV2: ...


class AnswerModelV2(Protocol):
    def stream_answer(
        self,
        request: RagAnswerRequestV2,
        evidence: Sequence[RetrievedEvidenceV2],
    ) -> AsyncIterator[str]: ...
