import asyncio
import hashlib
import hmac
from datetime import UTC, datetime
from uuid import UUID

import httpx
import pytest

from app.adapters.spring_status_callback import SpringStatusCallback
from app.contracts.live_status import LiveAgentError

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
SECRET = "callback-secret-that-is-at-least-32-bytes"
NOW = datetime(2026, 7, 27, 12, 35, tzinfo=UTC)


def callback(
    client: httpx.AsyncClient,
    **kwargs: object,
) -> SpringStatusCallback:
    values: dict[str, object] = {
        "client": client,
        "event_id_factory": lambda: "status-event-1",
        "clock": lambda: NOW,
        "timestamp_factory": lambda: 1_785_155_700,
        "retry_base_delay_seconds": 0,
    }
    values.update(kwargs)
    return SpringStatusCallback(
        "https://spring.example/internal/v1/ai/live-agent-status",
        SECRET,
        SESSION_ID,
        LESSON_ID,
        "livekit-job-1",
        "trace.live-1",
        **values,  # type: ignore[arg-type]
    )


async def test_posts_exact_signed_candidate_body_and_headers() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    reporter = callback(client)

    await reporter.report("SUCCEEDED")

    assert len(requests) == 1
    request = requests[0]
    expected_body = (
        b'{"contractVersion":"1","eventId":"status-event-1",'
        b'"eventType":"LIVE_AGENT_STATUS",'
        b'"sessionId":"11111111-1111-4111-8111-111111111111",'
        b'"lessonId":"22222222-2222-4222-8222-222222222222",'
        b'"jobId":"livekit-job-1","state":"SUCCEEDED",'
        b'"occurredAt":"2026-07-27T12:35:00.000Z"}'
    )
    assert request.content == expected_body
    expected_digest = hmac.new(
        SECRET.encode(),
        b"1785155700." + expected_body,
        hashlib.sha256,
    ).hexdigest()
    assert request.headers["Idempotency-Key"] == "status-event-1"
    assert request.headers["X-Correlation-Id"] == "trace.live-1"
    assert request.headers["X-LiveClass-Timestamp"] == "1785155700"
    assert request.headers["X-LiveClass-Signature"] == f"v1={expected_digest}"
    await client.aclose()


async def test_failed_status_serializes_error_exactly() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    reporter = callback(client)

    await reporter.report(
        "FAILED",
        LiveAgentError("STT_PROVIDER_FAILED", "provider unavailable", True),
    )

    assert requests[0].content.endswith(
        b'"error":{"code":"STT_PROVIDER_FAILED","message":"provider unavailable","retryable":true}}'
    )
    await client.aclose()


async def test_retry_reuses_exact_event_body_and_headers_and_is_bounded() -> None:
    requests: list[httpx.Request] = []
    sleeps: list[float] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(503)

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    reporter = callback(client, max_attempts=3, sleep=record_sleep)

    with pytest.raises(httpx.HTTPStatusError) as caught:
        await reporter.report("STT_STARTED")

    assert caught.value.response.status_code == 503
    assert len(requests) == 3
    assert [request.content for request in requests] == [requests[0].content] * 3
    assert [dict(request.headers) for request in requests] == [dict(requests[0].headers)] * 3
    assert sleeps == [0, 0]
    await client.aclose()


async def test_nonretryable_http_error_is_not_retried() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(400)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    reporter = callback(client)

    with pytest.raises(httpx.HTTPStatusError):
        await reporter.report("ROOM_CONNECTED")

    assert len(requests) == 1
    await client.aclose()


async def test_each_callback_attempt_has_an_explicit_timeout() -> None:
    class BlockingClient:
        def __init__(self) -> None:
            self.calls = 0

        async def post(self, *_args: object, **_kwargs: object) -> httpx.Response:
            self.calls += 1
            await asyncio.Future()
            raise AssertionError("unreachable")

    client = BlockingClient()
    reporter = callback(
        client,  # type: ignore[arg-type]
        timeout_seconds=0.01,
        max_attempts=2,
    )

    with pytest.raises(TimeoutError):
        await reporter.report("STT_STARTED")

    assert client.calls == 2


async def test_terminal_retry_call_reuses_event_and_opposite_terminal_is_rejected() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    event_ids = iter(["terminal-event-1", "must-not-be-created"])
    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    reporter = callback(client, event_id_factory=lambda: next(event_ids))

    await reporter.report("SUCCEEDED")
    await reporter.report("SUCCEEDED")
    with pytest.raises(RuntimeError, match="after terminal state SUCCEEDED"):
        await reporter.report(
            "FAILED",
            LiveAgentError("LATE_FAILURE", "must not be emitted", False),
        )

    assert len(requests) == 2
    assert requests[0].content == requests[1].content
    assert requests[0].headers["Idempotency-Key"] == "terminal-event-1"
    assert requests[1].headers["Idempotency-Key"] == "terminal-event-1"
    await client.aclose()


async def test_failed_requires_error_and_other_states_forbid_it() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(204)))
    reporter = callback(client)

    with pytest.raises(ValueError, match="requires error"):
        await reporter.report("FAILED")
    with pytest.raises(ValueError, match="only allowed"):
        await reporter.report(
            "AUDIO_STARTED",
            LiveAgentError("INVALID", "must not be sent", False),
        )
    await client.aclose()


def test_adapter_enforces_http_url_and_32_byte_secret() -> None:
    client = object()

    with pytest.raises(ValueError, match="http or https"):
        SpringStatusCallback(
            "ftp://spring.example/callback",
            SECRET,
            SESSION_ID,
            LESSON_ID,
            "job-1",
            "trace-1",
            client=client,  # type: ignore[arg-type]
        )
    with pytest.raises(ValueError, match="at least 32"):
        SpringStatusCallback(
            "https://spring.example/callback",
            "too-short",
            SESSION_ID,
            LESSON_ID,
            "job-1",
            "trace-1",
            client=client,  # type: ignore[arg-type]
        )


@pytest.mark.parametrize("timeout", [True, float("nan"), float("inf")])
def test_adapter_rejects_nonfinite_or_boolean_timeout(timeout: float) -> None:
    with pytest.raises(TypeError, match="finite number"):
        SpringStatusCallback(
            "https://spring.example/callback",
            SECRET,
            SESSION_ID,
            LESSON_ID,
            "job-1",
            "trace-1",
            timeout_seconds=timeout,
            client=object(),  # type: ignore[arg-type]
        )
