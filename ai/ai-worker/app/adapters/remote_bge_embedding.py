from __future__ import annotations

import math
import re
from collections.abc import Sequence

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from app.domain import BGE_M3_DIMENSIONS, BGE_M3_MODEL, EmbeddingContractError


_EMBEDDING_PATH = "/internal/v1/embeddings"
_IMMUTABLE_REVISION = re.compile(r"^[0-9a-f]{40}$")


class RemoteEmbeddingError(RuntimeError):
    """The remote runtime failed without exposing credentials or response bodies."""

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


class _EmbeddingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    revision: str
    dimensions: int
    normalized: bool
    embeddings: list[list[float]]


class RemoteBgeM3EmbeddingModel:
    """Call the pinned internal BGE runtime in bounded, ordered batches."""

    dimensions = BGE_M3_DIMENSIONS

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        internal_token: str,
        model_revision: str,
        model_name: str = BGE_M3_MODEL,
        max_batch_size: int = 4,
        max_text_chars: int = 4_000,
        request_timeout_seconds: float = 10.0,
    ) -> None:
        if model_name != BGE_M3_MODEL:
            raise ValueError(f"model_name must be {BGE_M3_MODEL}")
        if _IMMUTABLE_REVISION.fullmatch(model_revision) is None:
            raise ValueError("model_revision must be a full immutable commit revision")
        if (
            len(internal_token) < 32
            or not internal_token.strip()
            or internal_token != internal_token.strip()
        ):
            raise ValueError("internal_token must contain at least 32 unpadded characters")
        if not 1 <= max_batch_size <= 4:
            raise ValueError("max_batch_size must be between 1 and 4")
        if max_text_chars <= 0:
            raise ValueError("max_text_chars must be positive")
        if not 0 < request_timeout_seconds <= 120:
            raise ValueError("request_timeout_seconds must be between 0 and 120")

        self.model_name = model_name
        self.model_revision = model_revision
        self._client = client
        self._authorization = f"Bearer {internal_token}"
        self._max_batch_size = max_batch_size
        self._max_text_chars = max_text_chars
        self._request_timeout_seconds = request_timeout_seconds

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        copied = list(texts)
        if not copied:
            raise EmbeddingContractError("embedding input must not be empty")
        if any(
            not isinstance(value, str) or not value.strip() or len(value) > self._max_text_chars
            for value in copied
        ):
            raise EmbeddingContractError("embedding text violates the remote runtime contract")

        embeddings: list[list[float]] = []
        for offset in range(0, len(copied), self._max_batch_size):
            batch = copied[offset : offset + self._max_batch_size]
            embeddings.extend(await self._embed_batch(batch))
        return embeddings

    async def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        try:
            response = await self._client.post(
                _EMBEDDING_PATH,
                headers={"Authorization": self._authorization},
                json={
                    "model": self.model_name,
                    "revision": self.model_revision,
                    "texts": texts,
                },
                timeout=self._request_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise RemoteEmbeddingError(
                "BGE runtime request failed",
                retryable=True,
            ) from exc

        if response.status_code != httpx.codes.OK:
            self._raise_for_status(response.status_code)

        try:
            payload = _EmbeddingResponse.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise EmbeddingContractError("BGE runtime returned an invalid response") from exc

        if (
            payload.model != self.model_name
            or payload.revision != self.model_revision
            or payload.dimensions != self.dimensions
            or payload.normalized is not True
            or len(payload.embeddings) != len(texts)
        ):
            raise EmbeddingContractError("BGE runtime response identity does not match the request")
        if any(not _valid_vector(vector) for vector in payload.embeddings):
            raise EmbeddingContractError("BGE runtime returned an invalid embedding vector")
        return payload.embeddings

    @staticmethod
    def _raise_for_status(status_code: int) -> None:
        if status_code in {400, 409, 413, 422}:
            raise EmbeddingContractError(
                f"BGE runtime rejected the embedding contract with status {status_code}"
            )
        raise RemoteEmbeddingError(
            f"BGE runtime request failed with status {status_code}",
            status_code=status_code,
            retryable=status_code == 429 or status_code >= 500,
        )


def _valid_vector(vector: list[float]) -> bool:
    return (
        len(vector) == BGE_M3_DIMENSIONS
        and all(math.isfinite(value) for value in vector)
        and any(value != 0 for value in vector)
    )
