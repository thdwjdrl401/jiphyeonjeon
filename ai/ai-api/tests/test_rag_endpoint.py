import json
from collections.abc import AsyncIterator, Sequence
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api import InternalAuthenticationError
from app.config import Settings
from app.main import create_app
from app.rag import (
    CaptionSource,
    PptxSource,
    RagAnswerRequest,
    RagAnswerService,
    RetrievedEvidence,
    RetrievalResult,
)

TOKEN = "signed-token-placeholder"
LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
MATERIAL_ID = UUID("22222222-2222-4222-8222-222222222222")
SESSION_ID = "33333333-3333-4333-8333-333333333333"
PATH = "/internal/v1/rag/answers:stream"


class Authenticator:
    async def authenticate(self, authorization: str | None) -> None:
        if authorization != f"Bearer {TOKEN}":
            raise InternalAuthenticationError


class Retriever:
    def __init__(self) -> None:
        self.calls = 0

    async def retrieve(self, request: RagAnswerRequest) -> RetrievalResult:
        self.calls += 1
        return RetrievalResult(
            sufficient=True,
            evidence=(
                RetrievedEvidence(
                    lesson_id=request.lessonId,
                    content="PPTX 근거",
                    source=PptxSource(materialId=MATERIAL_ID, page=4),
                ),
                RetrievedEvidence(
                    lesson_id=request.lessonId,
                    content="자막 근거",
                    source=CaptionSource(
                        sessionId=request.sessionId,
                        sttSessionId="provider-session-1",
                        startMs=55_000,
                        endMs=59_000,
                    ),
                ),
            ),
        )


class Model:
    def __init__(self) -> None:
        self.calls = 0

    def stream_answer(
        self,
        request: RagAnswerRequest,
        evidence: Sequence[RetrievedEvidence],
    ) -> AsyncIterator[str]:
        self.calls += 1

        async def generate() -> AsyncIterator[str]:
            yield "설명한 개념은 "
            yield "RAG입니다."

        return generate()


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "requestId": "request-1",
        "lessonId": str(LESSON_ID),
        "sessionId": SESSION_ID,
        "question": "방금 설명한 개념은 무엇인가요?",
        "contextTimeMs": 61_500,
    }
    payload.update(overrides)
    return payload


def _headers(**overrides: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {TOKEN}",
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


def _app(retriever: Retriever | None = None, model: Model | None = None):
    resolved_retriever = retriever or Retriever()
    resolved_model = model or Model()
    return create_app(
        Settings(),
        rag_service=RagAnswerService(resolved_retriever, resolved_model),
        internal_authenticator=Authenticator(),
    )


def test_internal_endpoint_streams_contract_events_and_citations() -> None:
    retriever = Retriever()
    model = Model()

    with TestClient(_app(retriever, model)) as client:
        response = client.post(PATH, json=_payload(), headers=_headers())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache, no-transform"
    assert response.headers["x-accel-buffering"] == "no"
    assert _events(response.text) == [
        ("answer.delta", {"requestId": "request-1", "text": "설명한 개념은 "}),
        ("answer.delta", {"requestId": "request-1", "text": "RAG입니다."}),
        (
            "answer.done",
            {
                "requestId": "request-1",
                "sources": [
                    {"type": "PPTX", "materialId": str(MATERIAL_ID), "page": 4},
                    {
                        "type": "CAPTION",
                        "sessionId": SESSION_ID,
                        "sttSessionId": "provider-session-1",
                        "startMs": 55_000,
                        "endMs": 59_000,
                    },
                ],
            },
        ),
    ]
    assert retriever.calls == 1
    assert model.calls == 1


@pytest.mark.parametrize("authorization", [None, "Basic abc", "Bearer wrong"])
def test_internal_endpoint_rejects_invalid_auth_before_model_call(
    authorization: str | None,
) -> None:
    retriever = Retriever()
    model = Model()
    headers = {"Accept": "text/event-stream"}
    if authorization is not None:
        headers["Authorization"] = authorization

    with TestClient(_app(retriever, model)) as client:
        response = client.post(PATH, json=_payload(), headers=headers)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert retriever.calls == 0
    assert model.calls == 0


def test_internal_endpoint_requires_explicit_sse_accept_header() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            PATH,
            json=_payload(),
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert response.status_code == 406


def test_internal_auth_is_rejected_before_malformed_body_validation() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            PATH,
            json={"lessonId": "not-a-uuid"},
            headers={
                "Authorization": "Bearer wrong",
                "Accept": "text/event-stream",
            },
        )

    assert response.status_code == 401


def test_internal_endpoint_returns_400_for_invalid_contract_body() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            PATH,
            json=_payload(lessonId="not-a-uuid"),
            headers=_headers(),
        )

    assert response.status_code == 400
    assert response.json() == {"detail": "invalid RAG request"}


def test_internal_endpoint_is_unavailable_without_rag_wiring() -> None:
    app = create_app(Settings(), internal_authenticator=Authenticator())

    with TestClient(app) as client:
        response = client.post(PATH, json=_payload(), headers=_headers())

    assert response.status_code == 503


def test_internal_endpoint_fails_closed_without_auth_wiring() -> None:
    app = create_app(
        Settings(),
        rag_service=RagAnswerService(Retriever(), Model()),
    )

    with TestClient(app) as client:
        response = client.post(PATH, json=_payload(), headers=_headers())

    assert response.status_code == 503
