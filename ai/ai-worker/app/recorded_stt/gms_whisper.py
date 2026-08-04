from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError


class WhisperTranscriptionError(RuntimeError):
    def __init__(self, message: str, *, code: str, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class WhisperSegment(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, frozen=True)
    start: float
    end: float
    text: str


class WhisperResult(BaseModel):
    # JSON arrays arrive as lists; pydantic normalizes them to the immutable tuple below.
    model_config = ConfigDict(extra="ignore", frozen=True)
    duration: float
    segments: tuple[WhisperSegment, ...]


class GmsWhisperClient:
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
            raise ValueError("GMS API key must be non-empty and unpadded")
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
        data = {
            "model": self._model,
            "language": self._language,
            "response_format": "verbose_json",
        }
        if prompt:
            data["prompt"] = prompt[:1000]
        try:
            audio = chunk_path.read_bytes()
            response = await self._client.post(
                "/audio/transcriptions",
                data=data,
                files={"file": (chunk_path.name, audio, "audio/mpeg")},
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=self._timeout,
            )
        except (httpx.HTTPError, OSError) as exc:
            raise WhisperTranscriptionError(
                "GMS transcription request failed",
                code="STT_PROVIDER_UNAVAILABLE",
                retryable=True,
            ) from exc

        if response.status_code != httpx.codes.OK:
            if response.status_code == 400:
                raise WhisperTranscriptionError(
                    "configured STT model is unavailable",
                    code="STT_MODEL_UNAVAILABLE",
                    retryable=False,
                )
            if response.status_code == 413:
                raise WhisperTranscriptionError(
                    "GMS rejected an oversized audio chunk",
                    code="AUDIO_CHUNK_TOO_LARGE",
                    retryable=False,
                )
            raise WhisperTranscriptionError(
                "GMS transcription request was rejected",
                code="STT_PROVIDER_UNAVAILABLE",
                retryable=response.status_code == 429 or response.status_code >= 500,
            )
        try:
            result = WhisperResult.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise WhisperTranscriptionError(
                "GMS transcription response violated the contract",
                code="STT_RESPONSE_INVALID",
                retryable=False,
            ) from exc
        if result.duration < 0 or any(
            segment.start < 0 or segment.end <= segment.start for segment in result.segments
        ):
            raise WhisperTranscriptionError(
                "GMS transcription timestamps violated the contract",
                code="STT_RESPONSE_INVALID",
                retryable=False,
            )
        return result
