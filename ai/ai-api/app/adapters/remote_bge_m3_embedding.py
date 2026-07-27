from __future__ import annotations

import math

import httpx

from app.rag.errors import RagStreamFailure
from app.retrieval.service import EMBEDDING_DIMENSIONS


class RemoteBgeM3QueryEmbedding:
    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        model: str,
        revision: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not base_url or not token or not model or not revision:
            raise ValueError("remote embedding configuration is required")
        if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise ValueError("embedding timeout must be a positive finite value")
        self._model = model
        self._revision = revision
        self._authorization = f"Bearer {token}"
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout_seconds,
        )

    async def embed_query(self, text: str) -> tuple[float, ...]:
        try:
            response = await self._client.post(
                "/internal/v1/embeddings",
                headers={"Authorization": self._authorization},
                json={"model": self._model, "revision": self._revision, "texts": [text]},
            )
        except httpx.TimeoutException as exc:
            raise RagStreamFailure(code="EMBEDDING_TIMEOUT") from exc
        except httpx.TransportError as exc:
            raise RagStreamFailure(code="EMBEDDING_UNAVAILABLE") from exc
        if response.status_code == 408:
            raise RagStreamFailure(code="EMBEDDING_TIMEOUT")
        if response.status_code == 429 or response.status_code >= 500:
            raise RagStreamFailure(code="EMBEDDING_UNAVAILABLE")
        if response.status_code >= 400:
            raise RagStreamFailure(code="EMBEDDING_CONFIGURATION_ERROR")
        try:
            payload = response.json()
            embeddings = payload["embeddings"]
            vector = tuple(float(value) for value in embeddings[0])
            norm = math.sqrt(math.fsum(value * value for value in vector))
            valid = (
                payload["model"] == self._model
                and payload["revision"] == self._revision
                and payload["dimensions"] == EMBEDDING_DIMENSIONS
                and payload["normalized"] is True
                and len(embeddings) == 1
                and len(vector) == EMBEDDING_DIMENSIONS
                and all(math.isfinite(value) for value in vector)
                and math.isclose(norm, 1.0, rel_tol=1e-4, abs_tol=1e-4)
            )
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RagStreamFailure(code="EMBEDDING_CONFIGURATION_ERROR") from exc
        if not valid:
            raise RagStreamFailure(code="EMBEDDING_CONFIGURATION_ERROR")
        return vector

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()
