from typing import Protocol


class InternalAuthenticationError(Exception):
    """Raised when an internal caller cannot be authenticated."""


class InternalRequestAuthenticator(Protocol):
    """Authentication seam for the Spring-to-ai-api internal RAG call (ADR-0023 §9, HMAC)."""

    async def authenticate(self, raw_body: bytes, signature: str | None) -> None: ...
