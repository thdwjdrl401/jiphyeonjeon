from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Sequence

from app.rag.errors import RagStreamFailure
from app.rag.models import (
    AnnotationSource,
    AnswerDelta,
    AnswerDeltaData,
    AnswerDone,
    AnswerDoneData,
    AnswerError,
    AnswerErrorData,
    AnswerEvent,
    AnswerSource,
    CaptionSource,
    PptxSource,
    RagAnswerRequest,
    RetrievedEvidence,
)
from app.rag.ports import (
    AnswerModel,
    ConversationMemoryPort,
    EvidenceRetriever,
    GroundedCapture,
    ResponseIdCapture,
)
from app.rag.registry import InMemoryRequestRegistry, RequestLease, RequestRegistry

logger = logging.getLogger(__name__)

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
        conversation_memory: ConversationMemoryPort | None = None,
        session_fallback_enabled: bool = False,
    ) -> None:
        if retrieval_timeout_seconds <= 0 or model_timeout_seconds <= 0:
            raise ValueError("RAG timeouts must be positive")
        self._retriever = retriever
        self._model = model
        self._registry = registry or InMemoryRequestRegistry()
        self._retrieval_timeout_seconds = retrieval_timeout_seconds
        self._model_timeout_seconds = model_timeout_seconds
        self._conversation_memory = conversation_memory
        self._session_fallback_enabled = session_fallback_enabled

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

            grounded_capture = GroundedCapture()
            capture: ResponseIdCapture | None = None
            memory_key = _conversation_memory_key(request, self._session_fallback_enabled)
            previous_response_id: str | None = None
            memory_active = self._conversation_memory is not None and memory_key is not None
            if memory_active:
                previous_response_id = await self._safe_lookup_previous_response_id(
                    request, memory_key
                )

            # 죽은 previous_response_id(provider가 매핑을 잃음 — 재시작·키 로테이션)는 대화
            # 기억의 실패이지 답변의 실패가 아니다. 체이닝을 실은 첫 시도가 인증·구성 오류로
            # 죽으면 저장된 id를 버리고 체이닝 없이 한 번 다시 시도한다(fail-open, ADR-0010의
            # "대화 기억은 답변 가능 여부를 좌우하면 안 된다"). delta가 하나라도 나간 뒤에는
            # 재시도하지 않는다 — 클라이언트가 이미 본문을 받았다. 진짜 키 장애는 재시도도
            # 같은 오류로 죽으므로 숨겨지지 않는다.
            chain_attempts: tuple[str | None, ...] = (
                (previous_response_id, None) if previous_response_id is not None else (None,)
            )
            for chained_id in chain_attempts:
                grounded_capture = GroundedCapture()
                if memory_active:
                    capture = ResponseIdCapture()
                    deltas = self._model.stream_answer(
                        request,
                        result.evidence,
                        previous_response_id=chained_id,
                        response_id_capture=capture,
                        grounded_capture=grounded_capture,
                    )
                else:
                    deltas = self._model.stream_answer(
                        request, result.evidence, grounded_capture=grounded_capture
                    )

                yielded_any = False
                try:
                    try:
                        try:
                            async with asyncio.timeout(self._model_timeout_seconds):
                                async for text in deltas:
                                    if text == "":
                                        continue
                                    yielded_any = True
                                    yield AnswerDelta(
                                        data=AnswerDeltaData(requestId=request.requestId, text=text)
                                    )
                        except TimeoutError as error:
                            raise RagStreamFailure(code="MODEL_TIMEOUT") from error
                    finally:
                        await _close_iterator(deltas)
                except RagStreamFailure as error:
                    if (
                        chained_id is not None
                        and not yielded_any
                        and error.code in _STALE_CHAIN_FAILURE_CODES
                    ):
                        logger.warning(
                            "stored previous_response_id was rejected; retrying unchained",
                            extra={
                                "event": "rag.conversation_chain_dropped",
                                "request_id": request.requestId,
                                "error_code": error.code,
                            },
                        )
                        await self._safe_delete_response_id(request, memory_key)
                        continue
                    raise
                break

            if capture is not None and memory_key is not None and capture.value is not None:
                await self._safe_save_response_id(request, memory_key, capture.value)

            sources = _unique_sources(result.evidence) if grounded_capture.value else ()
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

    async def _safe_lookup_previous_response_id(
        self,
        request: RagAnswerRequest,
        memory_key: tuple[str, str, str],
    ) -> str | None:
        """Conversation memory is best-effort (ADR-0010): a lookup failure must not block the
        answer, it just means this turn is treated as the start of a new conversation."""
        user_id, session_id, conversation_id = memory_key
        try:
            return await self._conversation_memory.get_previous_response_id(
                user_id=user_id, session_id=session_id, conversation_id=conversation_id
            )
        except Exception as error:
            logger.warning(
                "conversation memory lookup failed; continuing without previous turn",
                extra={
                    "event": "rag.conversation_memory_lookup_failed",
                    "request_id": request.requestId,
                    "error_code": type(error).__name__,
                },
            )
            return None

    async def _safe_delete_response_id(
        self,
        request: RagAnswerRequest,
        memory_key: tuple[str, str, str],
    ) -> None:
        """죽은 체이닝 포인터를 남겨두면 TTL이 끝날 때까지 그 대화의 모든 질문이 같은 오류로
        죽는다. 삭제 실패는 다음 turn이 같은 복구를 반복하므로 답변을 막지 않는다."""
        user_id, session_id, conversation_id = memory_key
        try:
            await self._conversation_memory.delete_response_id(
                user_id=user_id, session_id=session_id, conversation_id=conversation_id
            )
        except Exception as error:
            logger.warning(
                "conversation memory delete failed; next turn will retry the recovery",
                extra={
                    "event": "rag.conversation_memory_delete_failed",
                    "request_id": request.requestId,
                    "error_code": type(error).__name__,
                },
            )

    async def _safe_save_response_id(
        self,
        request: RagAnswerRequest,
        memory_key: tuple[str, str, str],
        response_id: str,
    ) -> None:
        user_id, session_id, conversation_id = memory_key
        try:
            await self._conversation_memory.save_response_id(
                user_id=user_id,
                session_id=session_id,
                conversation_id=conversation_id,
                response_id=response_id,
            )
        except Exception as error:
            logger.warning(
                "conversation memory save failed; next turn will not be linked",
                extra={
                    "event": "rag.conversation_memory_save_failed",
                    "request_id": request.requestId,
                    "error_code": type(error).__name__,
                },
            )


# conversationId 없이 활성화된 대화의 범위 표지. Redis 키의 세 번째 자리를 채우는 고정값으로,
# 같은 (userId, sessionId)의 turn들이 하나의 대화로 이어지게 한다.
_SESSION_SCOPED_CONVERSATION = "session"

# 세션 폴백이 켜졌을 때 Redis 키의 userId 자리를 채우는 표지. 실제 사용자 식별자와 충돌하지
# 않는 값이어야 한다 — Identifier는 1자 이상이라 "-"도 유효한 사용자일 수 있지만, Spring은
# UUID/계정 식별자를 보내므로 실무 충돌은 없다.
_SESSION_FALLBACK_USER = "-"

# 체이닝을 실은 호출에서 이 코드들이 나오면 저장된 previous_response_id가 provider에서
# 죽었다는 뜻일 수 있다(실측: GMS는 모르는 previousId에 401을 반환 — AuthenticationError).
_STALE_CHAIN_FAILURE_CODES = frozenset({"MODEL_AUTH_FAILED", "MODEL_CONFIGURATION_ERROR"})


def _conversation_memory_key(
    request: RagAnswerRequest, session_fallback_enabled: bool = False
) -> tuple[str, str, str] | None:
    """userId만 있으면 대화 기억을 활성화한다(ADR-0046). 대화의 기본 단위는 "그 사용자의 그
    라이브 세션"이고, conversationId는 나중에 FE가 더 잘게 대화를 나누고 싶을 때 이 기본
    범위를 덮어쓰는 선택 필드다. 사용자를 구분할 수 없는 요청(userId 없음)은 기본적으로
    활성화하지 않는다 — sessionId는 수강생 전원이 공유하는 값이라 그것만으로 키를 만들면
    다른 학생의 대화가 이어진다.

    session_fallback_enabled는 그 안전핀을 의도적으로 여는 스위치다(기본 off): 질문자가
    한 명뿐인 시연·단일 사용자 환경에서 userId 없이도 세션 단위 대화를 잇는다. 여러 학생이
    질문하는 운영 세션에서 켜면 위의 섞임 사고가 그대로 되살아난다."""
    if request.userId is None:
        if not session_fallback_enabled:
            return None
        return (_SESSION_FALLBACK_USER, request.sessionId, _SESSION_SCOPED_CONVERSATION)
    conversation_id = request.conversationId or _SESSION_SCOPED_CONVERSATION
    return (request.userId, request.sessionId, conversation_id)


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
            # PPTX materials are shared curriculum-wide (ADR-0007): a hit's lesson_id may
            # legitimately differ from the requesting lesson, so curriculum_id is the proof.
            if item.curriculum_id != request.curriculumId:
                raise _EvidenceScopeViolation
        elif isinstance(item.source, AnnotationSource):
            # Highlight search is session-scoped (ADR-0089), so a hit from another session —
            # even one in the same curriculum — is a retrieval bug, not a legitimate result.
            if (
                item.curriculum_id != request.curriculumId
                or item.source.sessionId != request.sessionId
            ):
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
