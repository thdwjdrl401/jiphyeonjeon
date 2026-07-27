from collections.abc import AsyncIterator, Sequence
from typing import Protocol

from app.rag.models import RagAnswerRequest, RetrievedEvidence, RetrievalResult


class EvidenceRetriever(Protocol):
    async def retrieve(self, request: RagAnswerRequest) -> RetrievalResult: ...


class AnswerModel(Protocol):
    def stream_answer(
        self,
        request: RagAnswerRequest,
        evidence: Sequence[RetrievedEvidence],
    ) -> AsyncIterator[str]: ...
