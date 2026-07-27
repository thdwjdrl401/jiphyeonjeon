import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from functools import wraps
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.rag import (
    AnswerError,
    CaptionSource,
    PptxSource,
    RagAnswerRequest,
    RagAnswerService,
    RagStreamFailure,
    RetrievedEvidence,
    RetrievalResult,
    encode_sse_event,
    encode_sse_stream,
)

LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")
SESSION_ID = "44444444-4444-4444-8444-444444444444"


def async_test(test):
    @wraps(test)
    def run(*args, **kwargs):
        asyncio.run(asyncio.wait_for(test(*args, **kwargs), timeout=2))

    return run


def request(request_id: str = "request-1") -> RagAnswerRequest:
    return RagAnswerRequest(
        requestId=request_id,
        lessonId=LESSON_ID,
        sessionId=SESSION_ID,
        question="방금 설명한 개념은 무엇인가요?",
        contextTimeMs=615_000,
    )


def pptx_evidence(*, lesson_id: UUID = LESSON_ID) -> RetrievedEvidence:
    return RetrievedEvidence(
        lesson_id=lesson_id,
        content="강의 자료의 근거",
        source=PptxSource(materialId=MATERIAL_ID, page=4),
    )


def caption_evidence(
    *,
    lesson_id: UUID = LESSON_ID,
    session_id: str = SESSION_ID,
) -> RetrievedEvidence:
    return RetrievedEvidence(
        lesson_id=lesson_id,
        content="방금 말한 자막 근거",
        source=CaptionSource(
            sessionId=session_id,
            sttSessionId="provider-session-1",
            startMs=550_000,
            endMs=590_000,
        ),
    )


class Retriever:
    def __init__(self, result: RetrievalResult | None = None, error: Exception | None = None):
        self.result = result or RetrievalResult(sufficient=False)
        self.error = error
        self.requests: list[RagAnswerRequest] = []

    async def retrieve(self, current_request: RagAnswerRequest) -> RetrievalResult:
        self.requests.append(current_request)
        if self.error is not None:
            raise self.error
        return self.result


class Model:
    def __init__(self, chunks: Sequence[str] = (), error: Exception | None = None):
        self.chunks = chunks
        self.error = error
        self.calls: list[tuple[RagAnswerRequest, Sequence[RetrievedEvidence]]] = []

    def stream_answer(
        self,
        current_request: RagAnswerRequest,
        evidence: Sequence[RetrievedEvidence],
    ) -> AsyncIterator[str]:
        self.calls.append((current_request, evidence))

        async def generate() -> AsyncIterator[str]:
            for chunk in self.chunks:
                await asyncio.sleep(0)
                yield chunk
            if self.error is not None:
                raise self.error

        return generate()


async def collect(service: RagAnswerService, current_request: RagAnswerRequest):
    return [event async for event in service.stream(current_request)]


def test_contract_rejects_unknown_request_field_and_reversed_caption_range() -> None:
    with pytest.raises(ValidationError):
        RagAnswerRequest.model_validate(
            {
                **request().model_dump(mode="json"),
                "roiImage": {"objectKey": "deferred.png"},
            }
        )
    with pytest.raises(ValidationError):
        CaptionSource(
            sessionId=SESSION_ID,
            sttSessionId="provider-session-1",
            startMs=2,
            endMs=1,
        )


@pytest.mark.parametrize(
    ("chunks", "expected_events"),
    [
        (["설명한 개념은 ", "RAG입니다."], ["answer.delta", "answer.delta", "answer.done"]),
        ([], ["answer.done"]),
    ],
)
@async_test
async def test_grounded_answer_emits_deltas_then_one_done(
    chunks: list[str],
    expected_events: list[str],
) -> None:
    evidence = (pptx_evidence(), pptx_evidence(), caption_evidence())
    retriever = Retriever(RetrievalResult(sufficient=True, evidence=evidence))
    model = Model(chunks)

    events = await collect(RagAnswerService(retriever, model), request())

    assert [event.event for event in events] == expected_events
    assert events[-1].data.requestId == "request-1"
    assert events[-1].data.sources == (evidence[0].source, evidence[2].source)
    assert retriever.requests == [request()]
    assert model.calls == [(request(), evidence)]


@async_test
async def test_insufficient_evidence_is_terminal_and_skips_model() -> None:
    model = Model(["호출되면 안 됩니다."])

    events = await collect(
        RagAnswerService(Retriever(RetrievalResult(sufficient=False)), model),
        request(),
    )

    assert [event.event for event in events] == ["answer.insufficient"]
    assert model.calls == []


@pytest.mark.parametrize(
    "failure",
    [
        RuntimeError("postgresql://user:secret@example.invalid"),
        RagStreamFailure(code="invalid-code"),
    ],
)
@async_test
async def test_unknown_failure_emits_only_sanitized_error(failure: Exception) -> None:
    events = await collect(RagAnswerService(Retriever(error=failure), Model()), request())

    assert [event.event for event in events] == ["answer.error"]
    assert isinstance(events[0], AnswerError)
    assert events[0].data.code == "RAG_STREAM_FAILED"
    assert "secret" not in events[0].data.message


@pytest.mark.parametrize(
    ("code", "retryable"),
    [
        ("MODEL_TIMEOUT", True),
        ("MODEL_RATE_LIMITED", True),
        ("MODEL_UNAVAILABLE", True),
        ("MODEL_AUTH_FAILED", False),
        ("MODEL_CONFIGURATION_ERROR", False),
        ("EMBEDDING_TIMEOUT", True),
        ("EMBEDDING_UNAVAILABLE", True),
        ("EMBEDDING_CONFIGURATION_ERROR", False),
    ],
)
@async_test
async def test_known_adapter_failure_after_delta_ends_with_safe_error(
    code: str,
    retryable: bool,
) -> None:
    service = RagAnswerService(
        Retriever(RetrievalResult(sufficient=True, evidence=(pptx_evidence(),))),
        Model(["부분 답변"], RagStreamFailure(code=code)),
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.delta", "answer.error"]
    assert events[-1].data.code == code
    assert events[-1].data.retryable is retryable


@async_test
async def test_retrieval_timeout_skips_model_and_emits_terminal_error() -> None:
    class BlockingRetriever:
        async def retrieve(self, current_request):
            await asyncio.Event().wait()

    model = Model(["호출되면 안 됩니다."])
    service = RagAnswerService(
        BlockingRetriever(),
        model,
        retrieval_timeout_seconds=0.01,
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.error"]
    assert events[0].data.code == "RETRIEVAL_TIMEOUT"
    assert events[0].data.retryable is True
    assert model.calls == []


@async_test
async def test_model_timeout_closes_generation_with_terminal_error() -> None:
    class BlockingModel:
        def stream_answer(self, current_request, evidence):
            async def generate():
                await asyncio.Event().wait()
                yield "unreachable"

            return generate()

    service = RagAnswerService(
        Retriever(RetrievalResult(sufficient=True, evidence=(pptx_evidence(),))),
        BlockingModel(),
        model_timeout_seconds=0.01,
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.error"]
    assert events[0].data.code == "MODEL_TIMEOUT"


@pytest.mark.parametrize(
    "leaked_evidence",
    [
        pptx_evidence(lesson_id=OTHER_LESSON_ID),
        caption_evidence(lesson_id=OTHER_LESSON_ID),
        caption_evidence(session_id="55555555-5555-4555-8555-555555555555"),
    ],
)
@async_test
async def test_cross_scope_evidence_never_reaches_model(
    leaked_evidence: RetrievedEvidence,
) -> None:
    model = Model(["유출 답변"])
    service = RagAnswerService(
        Retriever(RetrievalResult(sufficient=True, evidence=(leaked_evidence,))),
        model,
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.error"]
    assert events[0].data.code == "EVIDENCE_SCOPE_VIOLATION"
    assert model.calls == []


@async_test
async def test_consumer_cancellation_reaches_model_and_closes_stream() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockingModel:
        def stream_answer(self, current_request, evidence):
            async def generate():
                started.set()
                try:
                    await asyncio.Event().wait()
                    yield "unreachable"
                except asyncio.CancelledError:
                    cancelled.set()
                    raise

            return generate()

    service = RagAnswerService(
        Retriever(RetrievalResult(sufficient=True, evidence=(pptx_evidence(),))),
        BlockingModel(),
    )
    encoded_stream = encode_sse_stream(service.stream(request()))
    next_event = asyncio.create_task(encoded_stream.__anext__())
    await started.wait()

    next_event.cancel()
    with pytest.raises(asyncio.CancelledError):
        await next_event

    assert cancelled.is_set()


@async_test
async def test_consumer_cancellation_reaches_retriever() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockingRetriever:
        async def retrieve(self, current_request):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

    stream = RagAnswerService(BlockingRetriever(), Model()).stream(request())
    next_event = asyncio.create_task(stream.__anext__())
    await started.wait()

    next_event.cancel()
    with pytest.raises(asyncio.CancelledError):
        await next_event

    assert cancelled.is_set()


@async_test
async def test_sse_encoder_uses_named_event_and_json_data_only() -> None:
    events = await collect(
        RagAnswerService(
            Retriever(RetrievalResult(sufficient=True, evidence=(pptx_evidence(),))),
            Model(["한글\n답변"]),
        ),
        request(),
    )

    encoded = encode_sse_event(events[0]).decode()
    lines = encoded.splitlines()

    assert lines[0] == "event: answer.delta"
    assert json.loads(lines[1].removeprefix("data: ")) == {
        "requestId": "request-1",
        "text": "한글\n답변",
    }
    assert encoded.endswith("\n\n")
