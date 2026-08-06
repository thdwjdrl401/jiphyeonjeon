from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Sequence

from app.rag.errors import RagStreamFailure
from app.rag.models import (
    AnswerDelta,
    AnnotationSourceV2,
    AnswerDeltaData,
    AnswerDoneDataV2,
    AnswerDoneV2,
    AnswerEventV2,
    AnswerSourceV2,
    CaptionSourceV2,
    PptxSourceV2,
    RagAnswerRequestV2,
    RetrievedEvidenceV2,
)
from app.rag.ports import AnswerModelV2, EvidenceRetrieverV2, GroundedCapture
from app.rag.registry import InMemoryRequestRegistry, RequestRegistry
from app.rag.service import (
    GENERIC_ERROR_MESSAGE,
    AnswerEventStream,
    _close_iterator,
    _error_event,
    _safe_adapter_error_event,
)

logger = logging.getLogger(__name__)


class _EvidenceScopeViolation(Exception):
    pass


class ReplayAnswerService:
    """Replay (v2) counterpart of RagAnswerService.

    The streaming/timeout/cancellation skeleton below is intentionally a near-duplicate of
    RagAnswerService._produce: reusing it directly would require RagAnswerService to accept v1
    and v2 request/evidence/event types interchangeably, which means editing app/rag/service.py
    — and ADR-0037 + docs/decisions/jinwoo/0008 both commit to leaving v1 files untouched. What
    *is* shared (imported, not copied) is everything that doesn't hardcode v1 types:
    AnswerEventStream, the request registry, the error catalog/messages, and the delta/close
    plumbing. Only the ~30 lines that construct v1-typed AnswerDone/validate v1 Source classes
    are duplicated here with v2 types.
    """

    def __init__(
        self,
        retriever: EvidenceRetrieverV2,
        model: AnswerModelV2,
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

    async def open(self, request: RagAnswerRequestV2) -> AnswerEventStream:
        """Reserve requestId before the HTTP adapter commits SSE headers."""

        lease = await self._registry.acquire(request.requestId)
        return AnswerEventStream(self._produce(request), lease)

    async def _produce(self, request: RagAnswerRequestV2) -> AsyncIterator[AnswerEventV2]:
        try:
            try:
                async with asyncio.timeout(self._retrieval_timeout_seconds):
                    result = await self._retriever.retrieve(request)
            except TimeoutError as error:
                raise RagStreamFailure(code="RETRIEVAL_TIMEOUT") from error

            _validate_evidence_scope_v2(request, result.evidence)

            grounded_capture = GroundedCapture()
            deltas = self._model.stream_answer(
                request, result.evidence, grounded_capture=grounded_capture
            )
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

            sources = _unique_sources_v2(result.evidence) if grounded_capture.value else ()
            yield AnswerDoneV2(data=AnswerDoneDataV2(requestId=request.requestId, sources=sources))
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
                "Replay RAG answer stream failed",
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


def _validate_evidence_scope_v2(
    request: RagAnswerRequestV2,
    evidence: Sequence[RetrievedEvidenceV2],
) -> None:
    for item in evidence:
        if isinstance(item.source, PptxSourceV2):
            # PPTX materials are shared curriculum-wide (ADR-0007): a hit's lesson_id may
            # legitimately differ from the requesting lesson, so curriculum_id is the proof.
            if item.curriculum_id != request.curriculumId:
                raise _EvidenceScopeViolation
        elif isinstance(item.source, AnnotationSourceV2):
            # Highlight search is session-scoped (ADR-0086), so a hit from another session —
            # even one in the same curriculum — is a retrieval bug, not a legitimate result.
            if (
                item.curriculum_id != request.curriculumId
                or item.source.sessionId != request.sessionId
            ):
                raise _EvidenceScopeViolation
        elif isinstance(item.source, CaptionSourceV2):
            if item.lesson_id != request.lessonId or item.source.sessionId != request.sessionId:
                raise _EvidenceScopeViolation
        else:  # pragma: no cover - AnswerSourceV2 is a closed discriminated union
            raise _EvidenceScopeViolation


def _unique_sources_v2(evidence: Sequence[RetrievedEvidenceV2]) -> tuple[AnswerSourceV2, ...]:
    """Dedup by (materialId,page) / (sessionId,startSessionMs,endSessionMs) only, per ADR-0037.

    Unlike v1's _unique_sources (whole-object equality), the key here deliberately excludes
    excerpt: two evidence items with the same identity but slightly different excerpt text must
    still collapse into one source.
    """

    sources: list[AnswerSourceV2] = []
    seen: set[tuple[object, ...]] = set()
    for item in evidence:
        source = item.source
        if isinstance(source, PptxSourceV2):
            key = ("PPTX", source.materialId, source.page)
        elif isinstance(source, AnnotationSourceV2):
            # highlightId is the snapshot's identity (ADR-0043 §6); excerpt stays out of the
            # key like every other branch here.
            key = ("ANNOTATION", source.highlightId)
        else:
            key = ("CAPTION", source.sessionId, source.startSessionMs, source.endSessionMs)
        if key in seen:
            continue
        seen.add(key)
        sources.append(source)
    return tuple(sources)
