import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from functools import wraps
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.rag import (
    AnnotationSourceV2,
    AnswerError,
    CaptionContextItem,
    CaptionSourceV2,
    DuplicateRequestError,
    InMemoryRequestRegistry,
    PptxSourceV2,
    RagAnswerRequestV2,
    RagStreamFailure,
    ReplayAnswerService,
    ReplayContext,
    RequestRegistryFullError,
    RetrievedEvidenceV2,
    RetrievalResultV2,
    encode_sse_event,
    encode_sse_stream,
)

LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
CURRICULUM_ID = UUID("66666666-6666-4666-8666-666666666666")
OTHER_CURRICULUM_ID = UUID("77777777-7777-4777-8777-777777777777")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")
SESSION_ID = "44444444-4444-4444-8444-444444444444"


def async_test(test):
    @wraps(test)
    def run(*args, **kwargs):
        asyncio.run(asyncio.wait_for(test(*args, **kwargs), timeout=2))

    return run


def request(request_id: str = "request-1") -> RagAnswerRequestV2:
    return RagAnswerRequestV2(
        requestId=request_id,
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question="여기서 말한 consumer group이 뭐야?",
        context=ReplayContext(questionSessionMs=735_000, captions=()),
        issuedAtMs=1_700_000_000_000,
    )


def pptx_evidence(
    *,
    lesson_id: UUID = LESSON_ID,
    curriculum_id: UUID = CURRICULUM_ID,
) -> RetrievedEvidenceV2:
    return RetrievedEvidenceV2(
        lesson_id=lesson_id,
        curriculum_id=curriculum_id,
        content="강의 자료의 근거",
        source=PptxSourceV2(materialId=MATERIAL_ID, page=4, excerpt="강의 자료의 근거"),
    )


def caption_evidence(
    *,
    lesson_id: UUID = LESSON_ID,
    session_id: str = SESSION_ID,
) -> RetrievedEvidenceV2:
    return RetrievedEvidenceV2(
        lesson_id=lesson_id,
        content="방금 말한 자막 근거",
        source=CaptionSourceV2(
            sessionId=session_id,
            startSessionMs=550_000,
            endSessionMs=590_000,
            excerpt="방금 말한 자막 근거",
        ),
    )


class Retriever:
    def __init__(self, result: RetrievalResultV2 | None = None, error: Exception | None = None):
        self.result = result or RetrievalResultV2(sufficient=False)
        self.error = error
        self.requests: list[RagAnswerRequestV2] = []

    async def retrieve(self, current_request: RagAnswerRequestV2) -> RetrievalResultV2:
        self.requests.append(current_request)
        if self.error is not None:
            raise self.error
        return self.result


class Model:
    def __init__(
        self,
        chunks: Sequence[str] = (),
        error: Exception | None = None,
        *,
        grounded: bool = True,
    ):
        self.chunks = chunks
        self.error = error
        self.grounded = grounded
        self.calls: list[tuple[RagAnswerRequestV2, Sequence[RetrievedEvidenceV2]]] = []

    def stream_answer(
        self,
        current_request: RagAnswerRequestV2,
        evidence: Sequence[RetrievedEvidenceV2],
        *,
        grounded_capture=None,
        **_ignored,
    ) -> AsyncIterator[str]:
        self.calls.append((current_request, evidence))
        if grounded_capture is not None:
            grounded_capture.value = self.grounded

        async def generate() -> AsyncIterator[str]:
            for chunk in self.chunks:
                await asyncio.sleep(0)
                yield chunk
            if self.error is not None:
                raise self.error

        return generate()


async def collect(service: ReplayAnswerService, current_request: RagAnswerRequestV2):
    stream = await service.open(current_request)
    return [event async for event in stream]


def test_contract_rejects_unknown_request_field_and_reversed_caption_range() -> None:
    with pytest.raises(ValidationError):
        RagAnswerRequestV2.model_validate(
            {
                **request().model_dump(mode="json"),
                "roiImage": {"objectKey": "deferred.png"},
            }
        )
    with pytest.raises(ValidationError):
        CaptionSourceV2(
            sessionId=SESSION_ID,
            startSessionMs=2,
            endSessionMs=1,
            excerpt="x",
        )


def _caption_item(
    *, text: str, index: int = 1, start_ms: int = 0, end_ms: int = 1_000
) -> CaptionContextItem:
    return CaptionContextItem(
        sttSessionId="stt-attempt-1",
        segmentIndex=index,
        startSessionMs=start_ms,
        endSessionMs=end_ms,
        text=text,
    )


def test_replay_context_rejects_more_than_20_captions() -> None:
    with pytest.raises(ValidationError):
        ReplayContext(
            questionSessionMs=1_000,
            captions=tuple(_caption_item(text="x", index=i) for i in range(21)),
        )


def test_replay_context_rejects_captions_over_6000_char_aggregate_budget() -> None:
    """ADR-0037: '최대 20개 발화, text 합계 최대 6,000자' — no single item exceeds it in this
    repro, but three items together (2,001 * 3 = 6,003) must still be rejected."""

    with pytest.raises(ValidationError):
        ReplayContext(
            questionSessionMs=1_000,
            captions=(
                _caption_item(text="가" * 2_001, index=1),
                _caption_item(text="나" * 2_001, index=2),
                _caption_item(text="다" * 2_001, index=3),
            ),
        )


def test_replay_context_accepts_captions_exactly_at_6000_char_aggregate_budget() -> None:
    ReplayContext(
        questionSessionMs=1_000,
        captions=(
            _caption_item(text="가" * 3_000, index=1),
            _caption_item(text="나" * 3_000, index=2),
        ),
    )


def test_caption_source_v2_excludes_stt_session_id() -> None:
    source = CaptionSourceV2(
        sessionId=SESSION_ID,
        startSessionMs=1,
        endSessionMs=2,
        excerpt="x",
    )
    assert "sttSessionId" not in source.model_dump()


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
    retriever = Retriever(RetrievalResultV2(sufficient=True, evidence=evidence))
    model = Model(chunks)

    events = await collect(ReplayAnswerService(retriever, model), request())

    assert [event.event for event in events] == expected_events
    assert events[-1].data.requestId == "request-1"
    # duplicate PPTX evidence collapses to one source; CAPTION source is kept
    assert events[-1].data.sources == (evidence[0].source, evidence[2].source)
    assert retriever.requests == [request()]
    assert model.calls == [(request(), evidence)]


@async_test
async def test_duplicate_pptx_with_different_excerpt_still_dedups_by_identity() -> None:
    """ADR-0037 dedup key excludes excerpt; _unique_sources_v2 must not use whole-object equality."""

    first = RetrievedEvidenceV2(
        lesson_id=LESSON_ID,
        curriculum_id=CURRICULUM_ID,
        content="같은 페이지 첫 청크",
        source=PptxSourceV2(materialId=MATERIAL_ID, page=4, excerpt="같은 페이지 첫 청크"),
    )
    second = RetrievedEvidenceV2(
        lesson_id=LESSON_ID,
        curriculum_id=CURRICULUM_ID,
        content="같은 페이지 다른 청크 텍스트",
        source=PptxSourceV2(materialId=MATERIAL_ID, page=4, excerpt="같은 페이지 다른 청크 텍스트"),
    )
    retriever = Retriever(RetrievalResultV2(sufficient=True, evidence=(first, second)))

    events = await collect(ReplayAnswerService(retriever, Model(["답변"])), request())

    assert [event.event for event in events] == ["answer.delta", "answer.done"]
    assert len(events[-1].data.sources) == 1
    assert events[-1].data.sources[0].excerpt == "같은 페이지 첫 청크"


@async_test
async def test_no_evidence_still_calls_model_with_empty_sources() -> None:
    """No PPTX/caption evidence found must not short-circuit before the model — the model may
    still answer from general knowledge, but with nothing to cite, sources stays empty."""

    model = Model(["일반 지식 답변"])

    events = await collect(
        ReplayAnswerService(Retriever(RetrievalResultV2(sufficient=False)), model),
        request(),
    )

    assert [event.event for event in events] == ["answer.delta", "answer.done"]
    assert model.calls == [(request(), ())]
    assert events[-1].data.sources == ()


@async_test
async def test_empty_sources_serializes_as_json_array_not_null_or_omitted() -> None:
    """ADR-0037's answer.done.sources was previously guaranteed non-empty (min_length=1); this
    relaxation must still produce a valid `"sources":[]` on the wire, not `null` or a missing
    key."""

    events = await collect(
        ReplayAnswerService(Retriever(RetrievalResultV2(sufficient=False)), Model(["답변"])),
        request(),
    )

    encoded = encode_sse_event(events[-1]).decode()
    lines = encoded.splitlines()
    assert lines[0] == "event: answer.done"
    payload = json.loads(lines[1].removeprefix("data: "))
    assert payload["sources"] == []


@async_test
async def test_general_tag_hides_sources_even_when_evidence_was_retrieved() -> None:
    """Evidence being retrieved doesn't mean the model actually used it — GroundedCapture, not
    evidence presence, decides sources."""

    evidence = (pptx_evidence(), caption_evidence())
    model = Model(["관련 없는 일반 답변"], grounded=False)

    events = await collect(
        ReplayAnswerService(
            Retriever(RetrievalResultV2(sufficient=True, evidence=evidence)), model
        ),
        request(),
    )

    assert [event.event for event in events] == ["answer.delta", "answer.done"]
    assert events[-1].data.sources == ()


@pytest.mark.parametrize(
    "failure",
    [
        RuntimeError("postgresql://user:secret@example.invalid"),
        RagStreamFailure(code="invalid-code"),
    ],
)
@async_test
async def test_unknown_failure_emits_only_sanitized_error(failure: Exception) -> None:
    events = await collect(ReplayAnswerService(Retriever(error=failure), Model()), request())

    assert [event.event for event in events] == ["answer.error"]
    assert isinstance(events[0], AnswerError)
    assert events[0].data.code == "RAG_STREAM_FAILED"
    assert "secret" not in events[0].data.message


@async_test
async def test_retrieval_timeout_skips_model_and_emits_terminal_error() -> None:
    class BlockingRetriever:
        async def retrieve(self, current_request):
            await asyncio.Event().wait()

    model = Model(["호출되면 안 됩니다."])
    service = ReplayAnswerService(
        BlockingRetriever(),
        model,
        retrieval_timeout_seconds=0.01,
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.error"]
    assert events[0].data.code == "RETRIEVAL_TIMEOUT"
    assert model.calls == []


@pytest.mark.parametrize(
    "leaked_evidence",
    [
        pptx_evidence(curriculum_id=OTHER_CURRICULUM_ID),
        caption_evidence(lesson_id=OTHER_LESSON_ID),
        caption_evidence(session_id="55555555-5555-4555-8555-555555555555"),
    ],
)
@async_test
async def test_cross_scope_evidence_never_reaches_model(
    leaked_evidence: RetrievedEvidenceV2,
) -> None:
    model = Model(["유출 답변"])
    service = ReplayAnswerService(
        Retriever(RetrievalResultV2(sufficient=True, evidence=(leaked_evidence,))),
        model,
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.error"]
    assert events[0].data.code == "EVIDENCE_SCOPE_VIOLATION"


@async_test
async def test_registry_rejects_active_recent_and_capacity_before_streaming() -> None:
    registry = InMemoryRequestRegistry(max_active=1, max_completed=2)
    service = ReplayAnswerService(Retriever(), Model(), registry)

    first = await service.open(request("request-1"))
    with pytest.raises(DuplicateRequestError):
        await service.open(request("request-1"))
    with pytest.raises(RequestRegistryFullError):
        await service.open(request("request-2"))

    assert [event.event async for event in first] == ["answer.done"]
    assert await registry.snapshot() == {"active": 0, "completed": 1}


@async_test
async def test_consumer_cancellation_reaches_model_and_closes_stream() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockingModel:
        def stream_answer(self, current_request, evidence, **_ignored):
            async def generate():
                started.set()
                try:
                    await asyncio.Event().wait()
                    yield "unreachable"
                except asyncio.CancelledError:
                    cancelled.set()
                    raise

            return generate()

    service = ReplayAnswerService(
        Retriever(RetrievalResultV2(sufficient=True, evidence=(pptx_evidence(),))),
        BlockingModel(),
    )
    encoded_stream = encode_sse_stream(await service.open(request()))
    next_event = asyncio.create_task(encoded_stream.__anext__())
    await started.wait()

    next_event.cancel()
    with pytest.raises(asyncio.CancelledError):
        await next_event

    assert cancelled.is_set()
    with pytest.raises(DuplicateRequestError):
        await service.open(request())


@async_test
async def test_sse_encoder_uses_named_event_and_json_data_only() -> None:
    events = await collect(
        ReplayAnswerService(
            Retriever(RetrievalResultV2(sufficient=True, evidence=(pptx_evidence(),))),
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


HIGHLIGHT_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")


def annotation_evidence(
    *,
    curriculum_id: UUID = CURRICULUM_ID,
    session_id: str = SESSION_ID,
    excerpt: str = "강조된 판서 근거",
) -> RetrievedEvidenceV2:
    return RetrievedEvidenceV2(
        lesson_id=LESSON_ID,
        curriculum_id=curriculum_id,
        content="강조된 판서 근거",
        source=AnnotationSourceV2(
            highlightId=HIGHLIGHT_ID, sessionId=session_id, sessionMs=725_300, excerpt=excerpt
        ),
    )


@async_test
async def test_annotation_evidence_in_scope_reaches_the_model_and_the_sources() -> None:
    """Regression: the closed-union else in _validate_evidence_scope_v2 treated every
    AnnotationSourceV2 as a scope violation, and _unique_sources_v2's CAPTION fallback would
    have crashed on it right after — grounding on a highlight killed the whole answer."""

    service = ReplayAnswerService(
        Retriever(RetrievalResultV2(sufficient=True, evidence=(annotation_evidence(),))),
        Model(["강조 기반 답변"]),
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.delta", "answer.done"]
    assert events[-1].data.sources == (
        AnnotationSourceV2(
            highlightId=HIGHLIGHT_ID,
            sessionId=SESSION_ID,
            sessionMs=725_300,
            excerpt="강조된 판서 근거",
        ),
    )


@async_test
async def test_annotation_sources_dedupe_on_highlight_id_not_excerpt() -> None:
    """Same identity with drifting excerpt must still collapse to one source, matching the
    (materialId,page)/(sessionId,ms) philosophy of the other v2 branches."""

    evidence = (
        annotation_evidence(excerpt="첫 발췌"),
        annotation_evidence(excerpt="살짝 다른 발췌"),
    )
    service = ReplayAnswerService(
        Retriever(RetrievalResultV2(sufficient=True, evidence=evidence)),
        Model(["강조 기반 답변"]),
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.delta", "answer.done"]
    assert len(events[-1].data.sources) == 1


@async_test
async def test_annotation_evidence_from_another_session_is_rejected() -> None:
    """Highlight search is session-scoped (ADR-0086): a hit from another session — even in the
    same curriculum — means retrieval is broken, so the guard must refuse to answer with it."""

    service = ReplayAnswerService(
        Retriever(
            RetrievalResultV2(
                sufficient=True,
                evidence=(annotation_evidence(session_id="55555555-5555-4555-8555-555555555555"),),
            )
        ),
        Model(["과거 세션 강조 기반 답변"]),
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.error"]
    assert events[0].data.code == "EVIDENCE_SCOPE_VIOLATION"


@async_test
async def test_annotation_evidence_from_another_curriculum_is_rejected() -> None:
    service = ReplayAnswerService(
        Retriever(
            RetrievalResultV2(
                sufficient=True,
                evidence=(annotation_evidence(curriculum_id=OTHER_CURRICULUM_ID),),
            )
        ),
        Model(["유출 답변"]),
    )

    events = await collect(service, request())

    assert [event.event for event in events] == ["answer.error"]
    assert events[0].data.code == "EVIDENCE_SCOPE_VIOLATION"
