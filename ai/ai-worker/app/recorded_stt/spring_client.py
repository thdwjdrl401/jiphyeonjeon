from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from app.adapters.spring_hmac import SpringHmacSigner
from app.recorded_stt.contracts import ChunkResult, SttProgress


class RecordedSttSpringError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        retryable: bool,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status_code = status_code


class _SourceUrl(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    url: str


class RecordedSttSpringClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        source_signer: SpringHmacSigner,
        callback_signer: SpringHmacSigner,
        *,
        request_timeout_seconds: float,
        download_timeout_seconds: float,
        source_max_bytes: int,
    ) -> None:
        self._client = client
        self._source_signer = source_signer
        self._callback_signer = callback_signer
        self._request_timeout = request_timeout_seconds
        self._download_timeout = download_timeout_seconds
        self._source_max_bytes = source_max_bytes

    async def issue_source_url(self, job_id: UUID) -> httpx.URL:
        body = b""
        try:
            response = await self._client.post(
                f"/api/internal/ai/recorded-stt-jobs/{job_id}/source-url",
                content=body,
                headers={"X-Signature": self._source_signer.sign(body)},
                timeout=self._request_timeout,
            )
        except httpx.HTTPError as exc:
            raise RecordedSttSpringError(
                "recorded STT source URL request failed",
                code="SOURCE_NOT_READY",
                retryable=True,
            ) from exc
        if response.status_code != httpx.codes.OK:
            raise RecordedSttSpringError(
                "recorded STT source URL request was rejected",
                code="SOURCE_NOT_READY",
                retryable=response.status_code in {404, 429} or response.status_code >= 500,
                status_code=response.status_code,
            )
        try:
            payload = _SourceUrl.model_validate(response.json())
            return _validated_url(payload.url)
        except (ValueError, ValidationError) as exc:
            raise RecordedSttSpringError(
                "recorded STT source URL response violated the contract",
                code="SOURCE_NOT_READY",
                retryable=False,
            ) from exc

    async def progress(self, job_id: UUID) -> SttProgress:
        body = b""
        try:
            response = await self._client.get(
                f"/api/internal/ai/recorded-stt-jobs/{job_id}/progress",
                headers={"X-Signature": self._callback_signer.sign(body)},
                timeout=self._request_timeout,
            )
        except httpx.HTTPError as exc:
            raise RecordedSttSpringError(
                "recorded STT progress request failed",
                code="WORKER_INTERNAL_ERROR",
                retryable=True,
            ) from exc
        if response.status_code != httpx.codes.OK:
            raise RecordedSttSpringError(
                "recorded STT progress request was rejected",
                code="WORKER_INTERNAL_ERROR",
                retryable=response.status_code == 429 or response.status_code >= 500,
                status_code=response.status_code,
            )
        try:
            return SttProgress.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise RecordedSttSpringError(
                "recorded STT progress response violated the contract",
                code="WORKER_INTERNAL_ERROR",
                retryable=False,
            ) from exc

    async def download_source(self, url: httpx.URL, destination: Path) -> int:
        downloaded = 0
        try:
            async with self._client.stream(
                "GET",
                url,
                follow_redirects=False,
                timeout=self._download_timeout,
            ) as response:
                if response.status_code != httpx.codes.OK:
                    raise RecordedSttSpringError(
                        "recorded source download failed",
                        code="SOURCE_DOWNLOAD_FAILED",
                        retryable=response.status_code in {401, 403, 404, 429}
                        or response.status_code >= 500,
                        status_code=response.status_code,
                    )
                declared = _content_length(response.headers.get("Content-Length"))
                if declared is not None and declared > self._source_max_bytes:
                    raise RecordedSttSpringError(
                        "recorded source exceeds configured byte limit",
                        code="SOURCE_TOO_LARGE",
                        retryable=False,
                    )
                with destination.open("wb") as output:
                    async for data in response.aiter_bytes():
                        downloaded += len(data)
                        if downloaded > self._source_max_bytes:
                            raise RecordedSttSpringError(
                                "recorded source exceeds configured byte limit",
                                code="SOURCE_TOO_LARGE",
                                retryable=False,
                            )
                        output.write(data)
        except RecordedSttSpringError:
            raise
        except (httpx.HTTPError, OSError) as exc:
            raise RecordedSttSpringError(
                "recorded source download failed",
                code="SOURCE_DOWNLOAD_FAILED",
                retryable=True,
            ) from exc
        if downloaded == 0:
            raise RecordedSttSpringError(
                "recorded source is empty",
                code="SOURCE_NOT_READY",
                retryable=False,
            )
        return downloaded

    async def submit_chunk(self, job_id: UUID, chunk_index: int, result: ChunkResult) -> None:
        body = result.raw_body()
        await self._send(
            "PUT",
            f"/api/internal/ai/recorded-stt-jobs/{job_id}/chunks/{chunk_index}",
            body,
            expected=httpx.codes.NO_CONTENT,
            code="WORKER_INTERNAL_ERROR",
        )

    async def send_terminal(
        self,
        *,
        event_id: str,
        job_id: UUID,
        recorded_video_id: UUID,
        status: str,
        output: dict[str, object] | None = None,
        failure_code: str | None = None,
    ) -> None:
        payload = {
            "eventId": event_id,
            "jobId": str(job_id),
            "recordedVideoId": str(recorded_video_id),
            "status": status,
            "output": output,
            "failureCode": failure_code,
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        await self._send(
            "POST",
            "/api/internal/ai/recorded-stt-callbacks",
            body,
            expected=httpx.codes.NO_CONTENT,
            code=failure_code or "WORKER_INTERNAL_ERROR",
        )

    async def _send(
        self,
        method: str,
        path: str,
        body: bytes,
        *,
        expected: int,
        code: str,
    ) -> None:
        try:
            response = await self._client.request(
                method,
                path,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Signature": self._callback_signer.sign(body),
                },
                timeout=self._request_timeout,
            )
        except httpx.HTTPError as exc:
            raise RecordedSttSpringError(
                "recorded STT callback request failed",
                code=code,
                retryable=True,
            ) from exc
        if response.status_code != expected:
            raise RecordedSttSpringError(
                "recorded STT callback was rejected",
                code=code,
                retryable=response.status_code in {409, 429} or response.status_code >= 500,
                status_code=response.status_code,
            )


def _validated_url(value: str) -> httpx.URL:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ValueError("source URL violates the HTTP capability contract")
    return httpx.URL(value)


def _content_length(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        size = int(value)
    except ValueError as exc:
        raise RecordedSttSpringError(
            "source Content-Length is invalid",
            code="SOURCE_DOWNLOAD_FAILED",
            retryable=False,
        ) from exc
    if size < 0:
        raise RecordedSttSpringError(
            "source Content-Length is invalid",
            code="SOURCE_DOWNLOAD_FAILED",
            retryable=False,
        )
    return size
