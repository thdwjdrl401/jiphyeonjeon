from __future__ import annotations

import base64
import hashlib
import hmac
import json
from uuid import UUID

import httpx
import pytest
from pydantic import ValidationError

from app.adapters.spring_hmac import SpringHmacSigner
from app.adapters.spring_material_callback import (
    SpringCallbackError,
    SpringMaterialCallbackClient,
)
from app.contracts import (
    KeyTermPayload,
    MaterialCallbackEvent,
    material_callback_event_id,
)


MATERIAL_ID = UUID("550e8400-e29b-41d4-a716-446655440000")
LESSON_ID = UUID("550e8400-e29b-41d4-a716-446655440002")
JOB_ID = f"PPTX_EMBED:{MATERIAL_ID}"
SECRET = "dev-ai-callback-secret"


def _event(**overrides: object) -> MaterialCallbackEvent:
    values: dict[str, object] = {
        "eventId": str(material_callback_event_id(JOB_ID, "MATERIAL_EMBEDDED")),
        "eventType": "MATERIAL_EMBEDDED",
        "jobId": JOB_ID,
        "materialId": str(MATERIAL_ID),
        "lessonId": str(LESSON_ID),
        "status": "READY",
        **overrides,
    }
    return MaterialCallbackEvent.model_validate(values)


async def test_sends_exact_signed_callback_body_and_accepts_204() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(204)

    event = _event()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        await SpringMaterialCallbackClient(client, SpringHmacSigner(SECRET)).send(event)

    request = captured["request"]
    expected_body = event.raw_body()
    expected_signature = base64.b64encode(
        hmac.new(SECRET.encode(), expected_body, hashlib.sha256).digest()
    ).decode()
    assert request.method == "POST"
    assert request.url.path == "/api/internal/ai/callbacks"
    assert request.content == expected_body
    assert request.headers["Content-Type"] == "application/json"
    assert request.headers["X-Signature"] == expected_signature
    assert json.loads(request.content) == {
        "eventId": str(event.event_id),
        "eventType": "MATERIAL_EMBEDDED",
        "jobId": JOB_ID,
        "materialId": str(MATERIAL_ID),
        "lessonId": str(LESSON_ID),
        "status": "READY",
    }


def test_callback_event_id_and_raw_body_are_stable_for_http_retry() -> None:
    first = _event()
    second = _event()

    assert first.event_id == second.event_id
    assert first.raw_body() == second.raw_body()
    assert material_callback_event_id(JOB_ID, "MATERIAL_EMBEDDING") != first.event_id
    assert material_callback_event_id(JOB_ID, "MATERIAL_EMBED_FAILED") != first.event_id


@pytest.mark.parametrize(
    ("event_type", "status"),
    [
        ("MATERIAL_EMBEDDING", "READY"),
        ("MATERIAL_EMBEDDED", "FAILED"),
        ("MATERIAL_EMBED_FAILED", "PROCESSING"),
    ],
)
def test_rejects_event_and_status_mismatch(event_type: str, status: str) -> None:
    with pytest.raises(ValidationError, match="status must match"):
        _event(eventType=event_type, status=status)


def test_key_terms_event_serializes_with_key_terms_present() -> None:
    event = _event(
        eventType="MATERIAL_KEY_TERMS_EXTRACTED",
        keyTerms=[{"term": "지도학습", "definition": "정답이 있는 데이터로 학습"}],
    )

    assert json.loads(event.raw_body()) == {
        "eventId": str(event.event_id),
        "eventType": "MATERIAL_KEY_TERMS_EXTRACTED",
        "jobId": JOB_ID,
        "materialId": str(MATERIAL_ID),
        "lessonId": str(LESSON_ID),
        "status": "READY",
        "keyTerms": [{"term": "지도학습", "definition": "정답이 있는 데이터로 학습"}],
    }


def test_key_terms_field_is_omitted_for_other_event_types() -> None:
    event = _event()

    assert "keyTerms" not in json.loads(event.raw_body())


def test_key_terms_is_required_for_and_exclusive_to_its_own_event_type() -> None:
    with pytest.raises(ValidationError, match="keyTerms"):
        _event(eventType="MATERIAL_KEY_TERMS_EXTRACTED")

    with pytest.raises(ValidationError, match="keyTerms"):
        _event(keyTerms=[{"term": "x", "definition": "y"}])


def test_key_term_payload_rejects_blank_fields() -> None:
    with pytest.raises(ValidationError):
        KeyTermPayload(term="", definition="정의")
    with pytest.raises(ValidationError):
        KeyTermPayload(term="용어", definition="")


@pytest.mark.parametrize(
    ("status_code", "retryable"),
    [(200, False), (400, False), (401, False), (429, True), (500, True)],
)
async def test_requires_204_and_classifies_http_failure(
    status_code: int,
    retryable: bool,
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(status_code)),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(SpringCallbackError) as caught:
            await SpringMaterialCallbackClient(client, SpringHmacSigner(SECRET)).send(_event())

    assert caught.value.status_code == status_code
    assert caught.value.retryable is retryable
    assert SECRET not in str(caught.value)


async def test_classifies_network_failure_as_retryable_without_secret_leak() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(SpringCallbackError) as caught:
            await SpringMaterialCallbackClient(client, SpringHmacSigner(SECRET)).send(_event())

    assert caught.value.status_code is None
    assert caught.value.retryable is True
    assert SECRET not in str(caught.value)
