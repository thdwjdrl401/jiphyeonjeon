from __future__ import annotations

import base64
import hashlib
import hmac


class SpringHmacSigner:
    """Sign the exact bytes sent to Spring's internal AI endpoints."""

    def __init__(self, secret: str) -> None:
        if not secret or not secret.strip() or secret != secret.strip():
            raise ValueError("Spring HMAC secret must not be blank or padded")
        self._secret = secret.encode("utf-8")

    def sign(self, body: bytes) -> str:
        digest = hmac.new(self._secret, body, hashlib.sha256).digest()
        return base64.b64encode(digest).decode("ascii")
