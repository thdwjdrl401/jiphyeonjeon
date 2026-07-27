from typing import Protocol


class InternalAuthenticationError(Exception):
    """Raised when an internal caller cannot be authenticated."""


class InternalRequestAuthenticator(Protocol):
    """Authentication seam for the future Spring-to-AI short-lived token."""

    async def authenticate(self, authorization: str | None) -> None: ...
