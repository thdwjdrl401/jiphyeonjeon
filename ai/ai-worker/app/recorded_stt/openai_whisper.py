from __future__ import annotations

import asyncio
import math
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError


class WhisperTranscriptionError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        retryable: bool,
        reason: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.reason = reason


class WhisperWord(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    start: float
    end: float
    word: str


class WhisperSegment(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    start: float
    end: float
    text: str


class WhisperResult(BaseModel):
    # JSON arrays arrive as lists; pydantic normalizes them to the immutable tuple below.
    model_config = ConfigDict(extra="ignore", frozen=True)
    duration: float
    text: str = ""
    segments: tuple[WhisperSegment, ...] = ()
    words: tuple[WhisperWord, ...] = ()


class OpenAIWhisperClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        api_key: str,
        model: str,
        language: str,
        timeout_seconds: float,
        retry_limit: int,
        retry_base_delay_seconds: float,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not api_key or api_key != api_key.strip():
            raise ValueError("OpenAI API key must be non-empty and unpadded")
        self._client = client
        self._api_key = api_key
        self._model = model
        self._language = language
        self._timeout = timeout_seconds
        self._retry_limit = retry_limit
        self._retry_base_delay = retry_base_delay_seconds
        self._sleep = sleep

    async def transcribe(self, chunk_path: Path, *, prompt: str | None = None) -> WhisperResult:
        for attempt in range(self._retry_limit + 1):
            try:
                return await self._request(chunk_path, prompt=prompt)
            except WhisperTranscriptionError as exc:
                if not exc.retryable or attempt >= self._retry_limit:
                    raise
                await self._sleep(min(60.0, self._retry_base_delay * (2**attempt)))
        raise AssertionError("unreachable")

    async def _request(self, chunk_path: Path, *, prompt: str | None) -> WhisperResult:
        multipart_fields: list[tuple[str, tuple[None, str] | tuple[str, bytes, str]]] = [
            ("model", (None, self._model)),
            ("language", (None, self._language)),
            ("response_format", (None, "verbose_json")),
            ("timestamp_granularities[]", (None, "segment")),
            ("timestamp_granularities[]", (None, "word")),
        ]
        if prompt:
            multipart_fields.append(("prompt", (None, prompt[:1000])))
        try:
            audio = chunk_path.read_bytes()
            multipart_fields.append(
                ("file", (chunk_path.name, audio, "audio/mpeg"))
            )
            response = await self._client.post(
                "/audio/transcriptions",
                files=multipart_fields,
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=self._timeout,
            )
        except (httpx.HTTPError, OSError) as exc:
            raise WhisperTranscriptionError(
                "OpenAI transcription request failed",
                code="STT_PROVIDER_UNAVAILABLE",
                retryable=True,
            ) from exc

        if response.status_code != httpx.codes.OK:
            if response.status_code == 400:
                raise WhisperTranscriptionError(
                    "configured STT request or model is unavailable",
                    code="STT_MODEL_UNAVAILABLE",
                    retryable=False,
                )
            if response.status_code == 413:
                raise WhisperTranscriptionError(
                    "OpenAI rejected an oversized audio chunk",
                    code="AUDIO_CHUNK_TOO_LARGE",
                    retryable=False,
                )
            raise WhisperTranscriptionError(
                "OpenAI transcription request was rejected",
                code="STT_PROVIDER_UNAVAILABLE",
                retryable=response.status_code == 429 or response.status_code >= 500,
            )
        try:
            result = WhisperResult.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise WhisperTranscriptionError(
                "OpenAI transcription response violated the contract",
                code="STT_RESPONSE_INVALID",
                retryable=False,
                reason="RESPONSE_SCHEMA_INVALID",
            ) from exc
        if not math.isfinite(result.duration) or result.duration < 0:
            raise WhisperTranscriptionError(
                "OpenAI transcription duration violated the contract",
                code="STT_RESPONSE_INVALID",
                retryable=False,
                reason="DURATION_INVALID",
            )
        return result
