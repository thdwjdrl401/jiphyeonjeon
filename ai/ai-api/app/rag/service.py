from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Sequence

from app.rag.errors import RagStreamFailure
from app.rag.models import (
    AnswerDelta,
    AnswerDeltaData,
    AnswerDone,
    AnswerDoneData,
    AnswerError,
    AnswerErrorData,
    AnswerEvent,
    AnswerInsufficient,
    AnswerInsufficientData,
    AnswerSource,
    CaptionSource,
    PptxSource,
    RagAnswerRequest,
    RetrievedEvidence,
)
from app.rag.ports import AnswerModel, EvidenceRetriever
from app.rag.registry import InMemoryRequestRegistry, RequestLease, RequestRegistry

logger = logging.getLogger(__name__)

INSUFFICIENT_MESSAGE = "강의에서 답변 근거를 찾지 못했습니다."
GENERIC_ERROR_MESSAGE = "답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."
_FAILURE_CATALOG = {
    "RETRIEVAL_TIMEOUT": ("강의 근거 검색 시간이 초과되었습니다.", True),
    "MODEL_TIMEOUT": ("모델 응답 시간이 초과되었습니다.", True),
    "MODEL_RATE_LIMITED": ("모델 요청이 일시적으로 제한되었습니다.", True),
    "MODEL_UNAVAILABLE": ("모델 서비스에 일시적으로 연결할 수 없습니다.", True),
    "MODEL_AUTH_FAILED": ("모델 서비스 인증 설정을 확인해 주세요.", False),
    "MODEL_CONFIGURATION_ERROR": ("모델 서비스 설정을 확인해 주세요.", False),
    "EMBEDDING_TIMEOUT": ("강의 근거 변환 시간이 초과되었습니다.", True),
    "EMBEDDING_UNAVAILABLE": ("강의 근거 검색 서비스에 연결할 수 없습니다.", True),
    "EMBEDDING_CONFIGURATION_ERROR": ("강의 근거 검색 설정을 확인해 주세요.", False),
}


class _EvidenceScopeViolation(Exception):
    pass


class RagAnswerService:
    def __init__(
        self,
        retriever: EvidenceRetriever,
        model: AnswerModel,
        registry: RequestRegistry | None = None,
        *,
        retrieval_timeout_seconds: float = 5.0,
        model_timeout_seconds: float = 60.0,
    ) -> None:
        if retrieval_timeout_seconds <= 0 or model_timeout_seconds <= 0:
            raise ValueError("RAG timeouts must be positive")
        self._retriever = retriever
        self._model = model
        self._registry = registry or InMemoryRequestRegistry()
        self._retrieval_timeout_seconds = retrieval_timeout_seconds
        self._model_timeout_seconds = model_timeout_seconds

    async def open(self, request: RagAnswerRequest) -> AnswerEventStream:
        """Reserve requestId before the HTTP adapter commits SSE headers."""

        lease = await self._registry.acquire(request.requestId)
        return AnswerEventStream(self._produce(request), lease)

    async def _produce(self, request: RagAnswerRequest) -> AsyncIterator[AnswerEvent]:
        try:
            try:
                async with asyncio.timeout(self._retrieval_timeout_seconds):
                    result = await self._retriever.retrieve(request)
            except TimeoutError as error:
                raise RagStreamFailure(code="RETRIEVAL_TIMEOUT") from error

            _validate_evidence_scope(request, result.evidence)
            if not result.sufficient:
                yield AnswerInsufficient(
                    data=AnswerInsufficientData(
                        requestId=request.requestId,
                        message=INSUFFICIENT_MESSAGE,
                    )
                )
                return

            sources = _unique_sources(result.evidence)
            deltas = self._model.stream_answer(request, result.evidence)
            try:
                try:
                    async with asyncio.timeout(self._model_timeout_seconds):
                        async for text in deltas:
                            if text == "":
                                continue
                            yield AnswerDelta(
                                data=AnswerDeltaData(requestId=request.requestId, text=text)
                            )
                except TimeoutError as error:
                    raise RagStreamFailure(code="MODEL_TIMEOUT") from error
            finally:
                await _close_iterator(deltas)

            yield AnswerDone(data=AnswerDoneData(requestId=request.requestId, sources=sources))
        except asyncio.CancelledError:
            raise
        except _EvidenceScopeViolation:
            logger.error(
                "retriever returned evidence outside the authorized request scope",
                extra={
                    "event": "rag.evidence_scope_violation",
                    "request_id": request.requestId,
                    "lesson_id": str(request.lessonId),
                    "session_id": request.sessionId,
                },
            )
            yield _error_event(
                request.requestId,
                code="EVIDENCE_SCOPE_VIOLATION",
                message=GENERIC_ERROR_MESSAGE,
                retryable=False,
            )
        except RagStreamFailure as error:
            yield _safe_adapter_error_event(request.requestId, error)
        except Exception as error:
            logger.error(
                "RAG answer stream failed",
                extra={
                    "event": "rag.answer_failed",
                    "request_id": request.requestId,
                    "lesson_id": str(request.lessonId),
                    "session_id": request.sessionId,
                    "error_code": type(error).__name__,
                },
            )
            yield _error_event(
                request.requestId,
                code="RAG_STREAM_FAILED",
                message=GENERIC_ERROR_MESSAGE,
                retryable=True,
            )


class AnswerEventStream(AsyncIterator[AnswerEvent]):
    """Release requestId on terminal, failure, explicit close, or disconnect."""

    def __init__(self, events: AsyncIterator[AnswerEvent], lease: RequestLease) -> None:
        self._events = events
        self._lease = lease
        self._closed = False
        self._close_lock = asyncio.Lock()

    def __aiter__(self) -> AnswerEventStream:
        return self

    async def __anext__(self) -> AnswerEvent:
        if self._closed:
            raise StopAsyncIteration
        try:
            event = await self._events.__anext__()
        except StopAsyncIteration:
            await self.aclose()
            raise
        except BaseException:
            await self.aclose()
            raise
        if not isinstance(event, AnswerDelta):
            await self.aclose()
        return event

    async def aclose(self) -> None:
        async with self._close_lock:
            if self._closed:
                return
            self._closed = True
            try:
                await _close_iterator(self._events)
            finally:
                await self._lease.complete()


def _validate_evidence_scope(
    request: RagAnswerRequest,
    evidence: Sequence[RetrievedEvidence],
) -> None:
    for item in evidence:
        if isinstance(item.source, PptxSource):
            # PPTX materials are shared curriculum-wide (ADR-0005): a hit's lesson_id may
            # legitimately differ from the requesting lesson, so curriculum_id is the proof.
            if item.curriculum_id != request.curriculumId:
                raise _EvidenceScopeViolation
        elif isinstance(item.source, CaptionSource):
            if item.lesson_id != request.lessonId or item.source.sessionId != request.sessionId:
                raise _EvidenceScopeViolation
        else:  # pragma: no cover - AnswerSource is a closed discriminated union
            raise _EvidenceScopeViolation


def _unique_sources(evidence: Sequence[RetrievedEvidence]) -> tuple[AnswerSource, ...]:
    sources: list[AnswerSource] = []
    seen: set[AnswerSource] = set()
    for item in evidence:
        if item.source in seen:
            continue
        seen.add(item.source)
        sources.append(item.source)
    return tuple(sources)


def _error_event(
    request_id: str,
    *,
    code: str,
    message: str,
    retryable: bool,
) -> AnswerError:
    return AnswerError(
        data=AnswerErrorData(
            requestId=request_id,
            code=code,
            message=message,
            retryable=retryable,
        )
    )


def _safe_adapter_error_event(request_id: str, error: RagStreamFailure) -> AnswerError:
    public_failure = _FAILURE_CATALOG.get(error.code)
    if public_failure is None:
        logger.error(
            "RAG adapter supplied an unknown error code",
            extra={
                "event": "rag.unknown_adapter_error",
                "request_id": request_id,
                "error_code": "UNKNOWN_ADAPTER_ERROR",
            },
        )
        return _error_event(
            request_id,
            code="RAG_STREAM_FAILED",
            message=GENERIC_ERROR_MESSAGE,
            retryable=True,
        )
    message, retryable = public_failure
    return _error_event(
        request_id,
        code=error.code,
        message=message,
        retryable=retryable,
    )


async def _close_iterator(iterator: AsyncIterator[object]) -> None:
    close = getattr(iterator, "aclose", None)
    if close is not None:
        await close()
