from __future__ import annotations

import asyncio
import hashlib
import hmac
import math
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx

from app.contracts.live_status import (
    TERMINAL_STATES,
    LiveAgentError,
    LiveAgentState,
    LiveAgentStatusEvent,
    parse_state,
)
from app.contracts.serialization import compact_json_bytes, utc_rfc3339

_SAFE_CORRELATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_RETRYABLE_STATUS_CODES = frozenset({408, 425, 429})


def serialize_status_event(event: LiveAgentStatusEvent) -> bytes:
    payload: dict[str, object] = {
        "contractVersion": event.contract_version,
        "eventId": event.event_id,
        "eventType": event.event_type,
        "sessionId": str(event.session_id),
        "lessonId": str(event.lesson_id),
        "jobId": event.job_id,
        "state": event.state,
        "occurredAt": utc_rfc3339(event.occurred_at),
    }
    if event.error is not None:
        payload["error"] = {
            "code": event.error.code,
            "message": event.error.message,
            "retryable": event.error.retryable,
        }
    return compact_json_bytes(payload)


def status_signature(secret: bytes, timestamp: str, body: bytes) -> str:
    digest = hmac.new(
        secret,
        timestamp.encode("ascii") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    return f"v1={digest}"


@dataclass(frozen=True, slots=True)
class _PreparedCallback:
    event: LiveAgentStatusEvent
    body: bytes
    headers: dict[str, str]


class SpringStatusCallback:
    """Deliver an AI-side candidate lifecycle event using stable retry bytes.

    Java does not consume this contract yet. Every retry for one report call uses
    the exact event ID, timestamp, body, and signature. Once a terminal event is
    prepared, an opposite or non-terminal state cannot be created by this client.
    """

    def __init__(
        self,
        url: str,
        secret: str,
        session_id: UUID,
        lesson_id: UUID,
        job_id: str,
        correlation_id: str,
        *,
        timeout_seconds: float = 0.75,
        max_attempts: int = 2,
        retry_base_delay_seconds: float = 0.1,
        client: httpx.AsyncClient | None = None,
        event_id_factory: Callable[[], str] | None = None,
        clock: Callable[[], datetime] | None = None,
        timestamp_factory: Callable[[], int] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not url:
            raise ValueError("callback url must not be empty")
        if urlparse(url).scheme not in {"http", "https"}:
            raise ValueError("callback url must use http or https")
        if len(secret.encode("utf-8")) < 32:
            raise ValueError("callback secret must be at least 32 UTF-8 bytes")
        if not isinstance(session_id, UUID):
            raise TypeError("session_id must be a UUID")
        if not isinstance(lesson_id, UUID):
            raise TypeError("lesson_id must be a UUID")
        if not isinstance(correlation_id, str) or not _SAFE_CORRELATION_ID.fullmatch(
            correlation_id
        ):
            raise ValueError("correlation_id must be a 1-128 character safe identifier")
        if isinstance(max_attempts, bool) or not isinstance(max_attempts, int):
            raise TypeError("max_attempts must be an integer")
        if not 1 <= max_attempts <= 5:
            raise ValueError("max_attempts must be between 1 and 5")
        if (
            isinstance(timeout_seconds, bool)
            or not isinstance(timeout_seconds, int | float)
            or not math.isfinite(timeout_seconds)
        ):
            raise TypeError("timeout_seconds must be a finite number")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if (
            isinstance(retry_base_delay_seconds, bool)
            or not isinstance(retry_base_delay_seconds, int | float)
            or not math.isfinite(retry_base_delay_seconds)
        ):
            raise TypeError("retry_base_delay_seconds must be a finite number")
        if retry_base_delay_seconds < 0:
            raise ValueError("retry_base_delay_seconds must not be negative")

        self._url = url
        self._secret = secret.encode("utf-8")
        self._session_id = session_id
        self._lesson_id = lesson_id
        self._job_id = job_id
        self._correlation_id = correlation_id
        self._timeout_seconds = float(timeout_seconds)
        self._max_attempts = max_attempts
        self._retry_base_delay_seconds = float(retry_base_delay_seconds)
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None
        self._event_id_factory = event_id_factory or (lambda: str(uuid4()))
        self._clock = clock or (lambda: datetime.now(UTC))
        self._timestamp_factory = timestamp_factory or (lambda: int(time.time()))
        self._sleep = sleep
        self._terminal: _PreparedCallback | None = None
        self._prepare_lock = asyncio.Lock()

    async def report(
        self,
        state: LiveAgentState,
        error: LiveAgentError | None = None,
    ) -> None:
        state = parse_state(state)
        async with self._prepare_lock:
            prepared = self._prepare_or_reuse_terminal(state, error)
        await self._post_with_retry(prepared)

    def _prepare_or_reuse_terminal(
        self,
        state: LiveAgentState,
        error: LiveAgentError | None,
    ) -> _PreparedCallback:
        if self._terminal is not None:
            if state != self._terminal.event.state or error != self._terminal.event.error:
                raise RuntimeError(
                    f"cannot report {state} after terminal state "
                    f"{self._terminal.event.state} was prepared"
                )
            return self._terminal

        event = LiveAgentStatusEvent(
            event_id=self._event_id_factory(),
            session_id=self._session_id,
            lesson_id=self._lesson_id,
            job_id=self._job_id,
            state=state,
            occurred_at=self._clock(),
            error=error,
        )
        body = serialize_status_event(event)
        timestamp = str(self._timestamp_factory())
        if not timestamp.isascii() or not timestamp.isdecimal():
            raise ValueError("callback timestamp must be a non-negative integer")
        prepared = _PreparedCallback(
            event=event,
            body=body,
            headers={
                "Content-Type": "application/json",
                "Idempotency-Key": event.event_id,
                "X-Correlation-Id": self._correlation_id,
                "X-LiveClass-Timestamp": timestamp,
                "X-LiveClass-Signature": status_signature(
                    self._secret,
                    timestamp,
                    body,
                ),
            },
        )
        if state in TERMINAL_STATES:
            self._terminal = prepared
        return prepared

    async def _post_with_retry(self, prepared: _PreparedCallback) -> None:
        for attempt in range(1, self._max_attempts + 1):
            try:
                async with asyncio.timeout(self._timeout_seconds):
                    response = await self._client.post(
                        self._url,
                        content=prepared.body,
                        headers=prepared.headers,
                    )
            except (TimeoutError, httpx.TransportError):
                if attempt == self._max_attempts:
                    raise
            else:
                if response.is_success:
                    return
                if not self._is_retryable_status(response.status_code):
                    response.raise_for_status()
                if attempt == self._max_attempts:
                    response.raise_for_status()

            delay = self._retry_base_delay_seconds * (2 ** (attempt - 1))
            await self._sleep(delay)
        raise AssertionError("bounded callback retry loop exhausted unexpectedly")

    @staticmethod
    def _is_retryable_status(status_code: int) -> bool:
        return status_code in _RETRYABLE_STATUS_CODES or 500 <= status_code <= 599

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()
