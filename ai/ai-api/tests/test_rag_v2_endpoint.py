import base64
import hashlib
import hmac
import json
import time
from collections.abc import AsyncIterator, Sequence
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.adapters import HmacInternalRequestAuthenticator
from app.api import InternalAuthenticationError
from app.config import Settings
from app.main import create_app
from app.rag import (
    CaptionSourceV2,
    InMemoryRequestRegistry,
    PptxSourceV2,
    RagAnswerRequestV2,
    RequestRegistryFullError,
    ReplayAnswerService,
    RetrievedEvidenceV2,
    RetrievalResultV2,
)

TOKEN = "signed-token-placeholder"
LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
CURRICULUM_ID = UUID("44444444-4444-4444-8444-444444444444")
MATERIAL_ID = UUID("22222222-2222-4222-8222-222222222222")
SESSION_ID = "33333333-3333-4333-8333-333333333333"
PATH = "/internal/v2/rag/answers:stream"


class Authenticator:
    async def authenticate(self, raw_body: bytes, signature: str | None) -> None:
        if signature != TOKEN:
            raise InternalAuthenticationError


class Retriever:
    def __init__(self) -> None:
        self.calls = 0

    async def retrieve(self, request: RagAnswerRequestV2) -> RetrievalResultV2:
        self.calls += 1
        return RetrievalResultV2(
            sufficient=True,
            evidence=(
                RetrievedEvidenceV2(
                    lesson_id=request.lessonId,
                    curriculum_id=request.curriculumId,
                    content="PPTX 근거",
                    source=PptxSourceV2(materialId=MATERIAL_ID, page=12, excerpt="PPTX 근거"),
                ),
                RetrievedEvidenceV2(
                    lesson_id=request.lessonId,
                    content="자막 근거",
                    source=CaptionSourceV2(
                        sessionId=request.sessionId,
                        startSessionMs=706_000,
                        endSessionMs=716_800,
                        excerpt="자막 근거",
                    ),
                ),
            ),
        )


class Model:
    def __init__(self) -> None:
        self.calls = 0

    def stream_answer(
        self,
        request: RagAnswerRequestV2,
        evidence: Sequence[RetrievedEvidenceV2],
        *,
        grounded_capture=None,
        **_ignored,
    ) -> AsyncIterator[str]:
        self.calls += 1
        if grounded_capture is not None:
            grounded_capture.value = True

        async def generate() -> AsyncIterator[str]:
            yield "컨슈머 그룹은 "
            yield "여러 소비자가 나눠 처리하는 단위입니다."

        return generate()


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "requestId": "request-1",
        "lessonId": str(LESSON_ID),
        "curriculumId": str(CURRICULUM_ID),
        "sessionId": SESSION_ID,
        "question": "여기서 말한 consumer group이 뭐야?",
        "context": {
            "mode": "REPLAY",
            "questionSessionMs": 735_000,
            "captions": [],
        },
        "issuedAtMs": 1_700_000_000_000,
    }
    payload.update(overrides)
    return payload


def _headers(**overrides: str) -> dict[str, str]:
    headers = {
        "X-Internal-Signature": TOKEN,
        "Accept": "text/event-stream",
    }
    headers.update(overrides)
    return headers


def _events(body: str) -> list[tuple[str, dict[str, object]]]:
    parsed = []
    for frame in body.strip().split("\n\n"):
        lines = frame.splitlines()
        assert len(lines) == 2
        parsed.append((lines[0].removeprefix("event: "), json.loads(lines[1][6:])))
    return parsed


def _app(
    retriever: Retriever | None = None,
    model: Model | None = None,
    registry=None,
):
    resolved_retriever = retriever or Retriever()
    resolved_model = model or Model()
    return create_app(
        Settings(),
        replay_rag_service=ReplayAnswerService(resolved_retriever, resolved_model, registry),
        internal_authenticator=Authenticator(),
    )


def test_v2_endpoint_streams_contract_events_with_excerpt_sources() -> None:
    retriever = Retriever()
    model = Model()

    with TestClient(_app(retriever, model)) as client:
        response = client.post(PATH, json=_payload(), headers=_headers())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache, no-transform"
    assert response.headers["x-accel-buffering"] == "no"
    assert _events(response.text) == [
        ("answer.delta", {"requestId": "request-1", "text": "컨슈머 그룹은 "}),
        (
            "answer.delta",
            {"requestId": "request-1", "text": "여러 소비자가 나눠 처리하는 단위입니다."},
        ),
        (
            "answer.done",
            {
                "requestId": "request-1",
                "sources": [
                    {
                        "type": "PPTX",
                        "materialId": str(MATERIAL_ID),
                        "page": 12,
                        "excerpt": "PPTX 근거",
                    },
                    {
                        "type": "CAPTION",
                        "sessionId": SESSION_ID,
                        "startSessionMs": 706_000,
                        "endSessionMs": 716_800,
                        "excerpt": "자막 근거",
                    },
                ],
            },
        ),
    ]
    assert retriever.calls == 1
    assert model.calls == 1


def test_v2_endpoint_rejects_recent_duplicate_before_new_stream() -> None:
    registry = InMemoryRequestRegistry()
    app = _app(registry=registry)

    with TestClient(app) as client:
        first = client.post(PATH, json=_payload(), headers=_headers())
        duplicate = client.post(PATH, json=_payload(), headers=_headers())

    assert first.status_code == 200
    assert duplicate.status_code == 409


def test_v2_endpoint_maps_registry_capacity_before_retrieval() -> None:
    class FullRegistry:
        async def acquire(self, request_id: str):
            raise RequestRegistryFullError("full")

    retriever = Retriever()
    model = Model()

    with TestClient(_app(retriever, model, FullRegistry())) as client:
        response = client.post(PATH, json=_payload(), headers=_headers())

    assert response.status_code == 503
    assert retriever.calls == 0
    assert model.calls == 0


@pytest.mark.parametrize("signature", [None, "", "wrong-signature"])
def test_v2_endpoint_rejects_invalid_auth_before_model_call(
    signature: str | None,
) -> None:
    retriever = Retriever()
    model = Model()
    headers = {"Accept": "text/event-stream"}
    if signature is not None:
        headers["X-Internal-Signature"] = signature

    with TestClient(_app(retriever, model)) as client:
        response = client.post(PATH, json=_payload(), headers=headers)

    assert response.status_code == 401
    assert retriever.calls == 0
    assert model.calls == 0


def test_v2_endpoint_requires_explicit_sse_accept_header() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            PATH,
            json=_payload(),
            headers={"X-Internal-Signature": TOKEN},
        )

    assert response.status_code == 406


def test_v2_endpoint_returns_400_for_invalid_contract_body() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            PATH,
            json=_payload(lessonId="not-a-uuid"),
            headers=_headers(),
        )

    assert response.status_code == 400
    assert response.json() == {"detail": "invalid RAG request"}


def test_v2_endpoint_is_unavailable_without_rag_wiring() -> None:
    app = create_app(Settings(), internal_authenticator=Authenticator())

    with TestClient(app) as client:
        response = client.post(PATH, json=_payload(), headers=_headers())

    assert response.status_code == 503


def test_v2_endpoint_fails_closed_without_auth_wiring() -> None:
    app = create_app(
        Settings(),
        replay_rag_service=ReplayAnswerService(Retriever(), Model()),
    )

    with TestClient(app) as client:
        response = client.post(PATH, json=_payload(), headers=_headers())

    assert response.status_code == 503


def test_v2_endpoint_accepts_real_hmac_signed_request() -> None:
    secret = b"integration-test-shared-secret"
    body = json.dumps(_payload(issuedAtMs=int(time.time() * 1000))).encode("utf-8")
    signature = base64.b64encode(hmac.new(secret, body, hashlib.sha256).digest()).decode("ascii")
    app = create_app(
        Settings(),
        replay_rag_service=ReplayAnswerService(Retriever(), Model()),
        internal_authenticator=HmacInternalRequestAuthenticator(secret),
    )

    with TestClient(app) as client:
        response = client.post(
            PATH,
            content=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "X-Internal-Signature": signature,
            },
        )

    assert response.status_code == 200


def test_v1_and_v2_endpoints_are_wired_independently() -> None:
    """Regression guard: v1 stays reachable and unaffected when only replay_rag_service is wired."""
    from app.rag import (
        PptxSource,
        RagAnswerRequest,
        RagAnswerService,
        RetrievedEvidence,
        RetrievalResult,
    )

    class V1Retriever:
        async def retrieve(self, request: RagAnswerRequest) -> RetrievalResult:
            return RetrievalResult(
                sufficient=True,
                evidence=(
                    RetrievedEvidence(
                        lesson_id=request.lessonId,
                        curriculum_id=request.curriculumId,
                        content="v1 근거",
                        source=PptxSource(materialId=MATERIAL_ID, page=1),
                    ),
                ),
            )

    class V1Model:
        def stream_answer(self, request, evidence, *, grounded_capture=None, **_ignored):
            if grounded_capture is not None:
                grounded_capture.value = True

            async def generate():
                yield "v1 답변"

            return generate()

    app = create_app(
        Settings(),
        rag_service=RagAnswerService(V1Retriever(), V1Model()),
        replay_rag_service=ReplayAnswerService(Retriever(), Model()),
        internal_authenticator=Authenticator(),
    )

    with TestClient(app) as client:
        v1_response = client.post(
            "/internal/v1/rag/answers:stream",
            json={
                "requestId": "v1-request",
                "lessonId": str(LESSON_ID),
                "curriculumId": str(CURRICULUM_ID),
                "sessionId": SESSION_ID,
                "question": "질문",
                "contextTimeMs": 1_000,
                "issuedAtMs": 1_700_000_000_000,
            },
            headers=_headers(),
        )
        v2_response = client.post(PATH, json=_payload(), headers=_headers())

    assert v1_response.status_code == 200
    assert v2_response.status_code == 200
