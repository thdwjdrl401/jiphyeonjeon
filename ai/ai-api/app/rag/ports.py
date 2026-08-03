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


class AnswerModel(Protocol):
    def stream_answer(
        self,
        request: RagAnswerRequest,
        evidence: Sequence[RetrievedEvidence],
    ) -> AsyncIterator[str]: ...


class EvidenceRetrieverV2(Protocol):
    async def retrieve(self, request: RagAnswerRequestV2) -> RetrievalResultV2: ...


class AnswerModelV2(Protocol):
    def stream_answer(
        self,
        request: RagAnswerRequestV2,
        evidence: Sequence[RetrievedEvidenceV2],
    ) -> AsyncIterator[str]: ...
