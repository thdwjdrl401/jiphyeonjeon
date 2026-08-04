import asyncio
import json
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from openai import APITimeoutError, RateLimitError

from app.adapters.gms_openai_answer import GMS_OPENAI_BASE_URL
from app.adapters.gms_openai_answer_v2 import GmsOpenAIAnswerModelV2
from app.rag import CaptionSourceV2, PptxSourceV2, RagAnswerRequestV2, RagStreamFailure, ReplayContext
from app.rag.models import RetrievedEvidenceV2
from app.rag.ports import GroundedCapture

LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
CURRICULUM_ID = UUID("55555555-5555-4555-8555-555555555555")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")
SESSION_ID = "44444444-4444-4444-8444-444444444444"


def _request() -> RagAnswerRequestV2:
    return RagAnswerRequestV2(
        requestId="request-private",
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question="여기서 말한 consumer group이 뭐야?",
        context=ReplayContext(questionSessionMs=735_000, captions=()),
        issuedAtMs=1_700_000_000_000,
    )


def _evidence() -> tuple[RetrievedEvidenceV2, ...]:
    return (
        RetrievedEvidenceV2(
            lesson_id=LESSON_ID,
            curriculum_id=CURRICULUM_ID,
            content="슬라이드의 컨슈머 그룹 설명",
            source=PptxSourceV2(materialId=MATERIAL_ID, page=12, excerpt="슬라이드의 컨슈머 그룹 설명"),
        ),
        RetrievedEvidenceV2(
            lesson_id=LESSON_ID,
            content="강사가 방금 컨슈머 그룹이라고 설명했습니다.",
            source=CaptionSourceV2(
                sessionId=SESSION_ID,
                startSessionMs=706_000,
                endSessionMs=716_800,
                excerpt="강사가 방금 컨슈머 그룹이라고 설명했습니다.",
            ),
        ),
    )


def _chunk(content: str | None):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content))])


class FakeStream:
    def __init__(self, chunks) -> None:
        self._chunks = iter(chunks)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._chunks)
        except StopIteration as error:
            raise StopAsyncIteration from error

    async def close(self) -> None:
        self.closed = True


class FakeCompletions:
    def __init__(self, *, stream=None, error: Exception | None = None) -> None:
        self.stream = stream
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.stream


class FakeClient:
    def __init__(self, completions: FakeCompletions) -> None:
        self.chat = SimpleNamespace(completions=completions)


def _model(client, *, max_prompt_chars: int = 100_000) -> GmsOpenAIAnswerModelV2:
    return GmsOpenAIAnswerModelV2(
        api_key="test-key",
        model="gpt-4.1",
        max_output_tokens=1_024,
        max_prompt_chars=max_prompt_chars,
        timeout_seconds=55,
        client=client,
    )


def test_streams_text_and_sends_v2_source_coordinates_not_excerpt() -> None:
    stream = FakeStream([_chunk("컨슈머 "), _chunk("그룹 답변")])
    completions = FakeCompletions(stream=stream)
    model = _model(FakeClient(completions))

    async def run() -> list[str]:
        return [chunk async for chunk in model.stream_answer(_request(), _evidence())]

    chunks = asyncio.run(run())

    assert chunks == ["컨슈머 ", "그룹 답변"]
    assert stream.closed is True
    payload = json.loads(completions.calls[0]["messages"][1]["content"])
    assert payload == {
        "question": "여기서 말한 consumer group이 뭐야?",
        # The moment the question was asked, so the model can resolve "아까" against each
        # annotation's highlightedAt (ADR-0043 §5-2).
        "askedAt": "12:15",
        "evidence": [
            {
                "source": {"type": "PPTX", "page": 12},
                "content": "슬라이드의 컨슈머 그룹 설명",
            },
            {
                "source": {"type": "CAPTION", "startSessionMs": 706_000, "endSessionMs": 716_800},
                "content": "강사가 방금 컨슈머 그룹이라고 설명했습니다.",
            },
        ],
    }
    serialized = completions.calls[0]["messages"][1]["content"]
    assert "request-private" not in serialized
    assert str(MATERIAL_ID) not in serialized
    assert SESSION_ID not in serialized


def test_prompt_limit_fails_before_provider_call() -> None:
    completions = FakeCompletions(stream=FakeStream([]))

    async def run() -> None:
        with pytest.raises(RagStreamFailure) as captured:
            await (
                _model(FakeClient(completions), max_prompt_chars=10)
                .stream_answer(_request(), _evidence())
                .__anext__()
            )
        assert captured.value.code == "MODEL_CONFIGURATION_ERROR"

    asyncio.run(run())
    assert completions.calls == []


def test_maps_provider_failures_to_stable_codes() -> None:
    request = httpx.Request("POST", f"{GMS_OPENAI_BASE_URL}/chat/completions")
    error = APITimeoutError(request=request)

    async def run() -> None:
        with pytest.raises(RagStreamFailure) as captured:
            await (
                _model(FakeClient(FakeCompletions(error=error)))
                .stream_answer(_request(), _evidence())
                .__anext__()
            )
        assert captured.value.code == "MODEL_TIMEOUT"

    asyncio.run(run())


def test_rate_limit_maps_to_retryable_code() -> None:
    request = httpx.Request("POST", f"{GMS_OPENAI_BASE_URL}/chat/completions")
    response = httpx.Response(429, request=request)
    error = RateLimitError("rate limited", response=response, body=None)

    async def run() -> None:
        with pytest.raises(RagStreamFailure) as captured:
            await (
                _model(FakeClient(FakeCompletions(error=error)))
                .stream_answer(_request(), _evidence())
                .__anext__()
            )
        assert captured.value.code == "MODEL_RATE_LIMITED"

    asyncio.run(run())


def test_grounded_tag_is_stripped_and_capture_set_true() -> None:
    stream = FakeStream([_chunk("[GROUNDED]\n"), _chunk("컨슈머 그룹 답변")])
    completions = FakeCompletions(stream=stream)
    model = _model(FakeClient(completions))
    capture = GroundedCapture()

    async def run() -> list[str]:
        return [
            chunk
            async for chunk in model.stream_answer(
                _request(), _evidence(), grounded_capture=capture
            )
        ]

    chunks = asyncio.run(run())

    assert "".join(chunks) == "컨슈머 그룹 답변"
    assert capture.value is True


def test_empty_evidence_still_reaches_the_model_as_general_knowledge_fallback() -> None:
    stream = FakeStream([_chunk("[GENERAL]\n일반 지식으로 답합니다.")])
    completions = FakeCompletions(stream=stream)
    model = _model(FakeClient(completions))
    capture = GroundedCapture()

    async def run() -> list[str]:
        return [
            chunk
            async for chunk in model.stream_answer(_request(), (), grounded_capture=capture)
        ]

    chunks = asyncio.run(run())

    assert "".join(chunks) == "일반 지식으로 답합니다."
    assert capture.value is False
    payload = json.loads(completions.calls[0]["messages"][1]["content"])
    assert payload["evidence"] == []
