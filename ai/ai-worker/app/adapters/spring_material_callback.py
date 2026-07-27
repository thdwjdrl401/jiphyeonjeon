from __future__ import annotations

import httpx

from app.adapters.spring_hmac import SpringHmacSigner
from app.contracts import MaterialCallbackEvent


_CALLBACK_PATH = "/api/internal/ai/callbacks"


class SpringCallbackError(RuntimeError):
    """Spring callback failed with a classification for the future consumer."""

    def __init__(
        self,
        message: str,
        *,
        retryable: bool,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status_code = status_code


class SpringMaterialCallbackClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        signer: SpringHmacSigner,
        *,
        timeout_seconds: float = 5.0,
    ) -> None:
        if not 0 < timeout_seconds <= 120:
            raise ValueError("timeout_seconds must be between 0 and 120")
        self._client = client
        self._signer = signer
        self._timeout_seconds = timeout_seconds

    async def send(self, event: MaterialCallbackEvent) -> None:
        body = event.raw_body()
        try:
            response = await self._client.post(
                _CALLBACK_PATH,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Signature": self._signer.sign(body),
                },
                timeout=self._timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise SpringCallbackError(
                "Spring material callback failed",
                retryable=True,
            ) from exc

        if response.status_code != httpx.codes.NO_CONTENT:
            raise SpringCallbackError(
                f"Spring material callback failed with status {response.status_code}",
                status_code=response.status_code,
                retryable=response.status_code == 429 or response.status_code >= 500,
            )
