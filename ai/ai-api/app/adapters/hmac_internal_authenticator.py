from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from app.api.internal_auth import InternalAuthenticationError

_DEFAULT_FRESHNESS_WINDOW_MS = 60_000
_MAX_CLOCK_SKEW_MS = 5_000


class HmacInternalRequestAuthenticator:
    """Verifies Spring-issued internal RAG requests per ADR-0023 §9 (HMAC shared secret).

    The signature covers the raw request body; `issuedAtMs` inside the body must
    fall within a short freshness window so a captured request cannot be replayed later.
    A small future-clock tolerance (`_MAX_CLOCK_SKEW_MS`) is enforced beyond what ADR-0023
    §9 states explicitly: without it, an `issuedAtMs` set far in the future would make
    `now - issuedAtMs` negative and trivially pass the freshness check, defeating it.
    """

    def __init__(
        self,
        secret: bytes,
        *,
        freshness_window_ms: int = _DEFAULT_FRESHNESS_WINDOW_MS,
    ) -> None:
        if not secret:
            raise ValueError("HMAC secret must not be empty")
        self._secret = secret
        self._freshness_window_ms = freshness_window_ms

    async def authenticate(self, raw_body: bytes, signature: str | None) -> None:
        if not signature:
            raise InternalAuthenticationError("missing X-Internal-Signature")
        expected = base64.b64encode(
            hmac.new(self._secret, raw_body, hashlib.sha256).digest()
        ).decode("ascii")
        if not hmac.compare_digest(expected, signature):
            raise InternalAuthenticationError("invalid signature")

        issued_at_ms = _extract_issued_at_ms(raw_body)
        now_ms = int(time.time() * 1000)
        if issued_at_ms > now_ms + _MAX_CLOCK_SKEW_MS:
            raise InternalAuthenticationError("issuedAtMs is in the future")
        if now_ms - issued_at_ms > self._freshness_window_ms:
            raise InternalAuthenticationError("request is stale")


def _extract_issued_at_ms(raw_body: bytes) -> int:
    try:
        payload = json.loads(raw_body)
        issued_at_ms = payload["issuedAtMs"]
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError, TypeError) as exc:
        raise InternalAuthenticationError("missing or invalid issuedAtMs") from exc
    if not isinstance(issued_at_ms, int) or isinstance(issued_at_ms, bool):
        raise InternalAuthenticationError("issuedAtMs must be an integer")
    return issued_at_ms
