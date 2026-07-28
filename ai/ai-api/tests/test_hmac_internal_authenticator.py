import asyncio
import base64
import hashlib
import hmac
import json
import time
from functools import wraps

import pytest

from app.adapters import HmacInternalRequestAuthenticator
from app.api import InternalAuthenticationError

SECRET = b"test-secret-shared-between-spring-and-ai-api"


def async_test(test):
    @wraps(test)
    def run(*args, **kwargs):
        asyncio.run(asyncio.wait_for(test(*args, **kwargs), timeout=2))

    return run


def _sign(secret: bytes, body: bytes) -> str:
    return base64.b64encode(hmac.new(secret, body, hashlib.sha256).digest()).decode("ascii")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _body(issued_at_ms: int, **overrides: object) -> bytes:
    payload: dict[str, object] = {
        "lessonId": "11111111-1111-4111-8111-111111111111",
        "sessionId": "session-1",
        "requestId": "request-1",
        "issuedAtMs": issued_at_ms,
        "question": "방금 설명한 개념은 무엇인가요?",
    }
    payload.update(overrides)
    return json.dumps(payload).encode("utf-8")


def test_constructor_rejects_empty_secret() -> None:
    with pytest.raises(ValueError):
        HmacInternalRequestAuthenticator(b"")


@async_test
async def test_accepts_valid_signature_within_freshness_window() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(_now_ms())

    await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_accepts_request_at_freshness_window_boundary() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET, freshness_window_ms=60_000)
    body = _body(_now_ms() - 60_000)

    await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_rejects_request_one_ms_past_freshness_window_boundary() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET, freshness_window_ms=60_000)
    body = _body(_now_ms() - 60_001)

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_rejects_missing_signature() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(_now_ms())

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, None)


@async_test
async def test_rejects_empty_signature() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(_now_ms())

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, "")


@async_test
async def test_rejects_tampered_body() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(_now_ms())
    signature = _sign(SECRET, body)
    tampered_body = _body(_now_ms(), question="변조된 질문")

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(tampered_body, signature)


@async_test
async def test_rejects_signature_from_wrong_secret() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(_now_ms())

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(b"a-different-secret", body))


@async_test
async def test_rejects_stale_request_past_freshness_window() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET, freshness_window_ms=60_000)
    body = _body(_now_ms() - 61_000)

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_accepts_issued_at_within_clock_skew_tolerance() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(_now_ms() + 2_000)

    await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_rejects_issued_at_too_far_in_the_future() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(_now_ms() + 10_000)

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_rejects_missing_issued_at_field() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    payload = {
        "lessonId": "11111111-1111-4111-8111-111111111111",
        "sessionId": "session-1",
        "requestId": "request-1",
        "question": "방금 설명한 개념은 무엇인가요?",
    }
    body = json.dumps(payload).encode("utf-8")

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_rejects_malformed_json_body() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = b"not-json"

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_rejects_non_utf8_body_as_auth_failure_not_crash() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = b"\xff\xfe not valid utf-8"

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))


@async_test
async def test_rejects_empty_body() -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = b""

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))


@pytest.mark.parametrize("issued_at_ms", ["1700000000000", 1_700_000_000_000.5, True])
@async_test
async def test_rejects_issued_at_of_wrong_type(issued_at_ms: object) -> None:
    authenticator = HmacInternalRequestAuthenticator(SECRET)
    body = _body(0, issuedAtMs=issued_at_ms)

    with pytest.raises(InternalAuthenticationError):
        await authenticator.authenticate(body, _sign(SECRET, body))
