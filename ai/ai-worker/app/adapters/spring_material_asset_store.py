from __future__ import annotations

import json
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from app.adapters.spring_hmac import SpringHmacSigner
from app.application import SPRING_ASSET_SOURCE
from app.domain import MaterialIngestionError, PptxLimitExceededError


_DOWNLOAD_URL_PATH = "/api/internal/ai/materials/download-url"
_PPTX_MEDIA_TYPES = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/octet-stream",
    }
)


class SpringMaterialSourceError(RuntimeError):
    """Spring or presigned storage failed with an explicit retry classification."""

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


class _DownloadUrlResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    url: str


class SpringPresignedPptxAssetStore:
    """Issue one signed capability URL and immediately stream its bounded PPTX bytes."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        signer: SpringHmacSigner,
        *,
        source_max_bytes: int,
        issue_timeout_seconds: float = 5.0,
        download_timeout_seconds: float = 30.0,
    ) -> None:
        if source_max_bytes <= 0:
            raise ValueError("source_max_bytes must be positive")
        if not 0 < issue_timeout_seconds <= 120:
            raise ValueError("issue_timeout_seconds must be between 0 and 120")
        if not 0 < download_timeout_seconds <= 600:
            raise ValueError("download_timeout_seconds must be between 0 and 600")
        self._client = client
        self._signer = signer
        self._source_max_bytes = source_max_bytes
        self._issue_timeout_seconds = issue_timeout_seconds
        self._download_timeout_seconds = download_timeout_seconds

    async def read_pptx(self, bucket: str, object_key: str) -> bytes:
        asset_id = _parse_source_reference(bucket, object_key)
        body = json.dumps(
            {"assetId": str(asset_id)},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        download_url = await self._issue_download_url(body)
        return await self._download(download_url)

    async def _issue_download_url(self, body: bytes) -> httpx.URL:
        try:
            response = await self._client.post(
                _DOWNLOAD_URL_PATH,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Signature": self._signer.sign(body),
                },
                timeout=self._issue_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise SpringMaterialSourceError(
                "material download URL request failed",
                retryable=True,
            ) from exc

        if response.status_code != httpx.codes.OK:
            _raise_issue_status(response.status_code)
        try:
            payload = _DownloadUrlResponse.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise SpringMaterialSourceError(
                "material download URL response violated the contract",
                retryable=False,
            ) from exc
        return _validated_download_url(payload.url)

    async def _download(self, download_url: httpx.URL) -> bytes:
        try:
            async with self._client.stream(
                "GET",
                download_url,
                timeout=self._download_timeout_seconds,
                follow_redirects=False,
            ) as response:
                if response.status_code != httpx.codes.OK:
                    _raise_download_status(response.status_code)
                declared_size = _declared_size(response.headers.get("Content-Length"))
                if declared_size is not None and declared_size > self._source_max_bytes:
                    raise PptxLimitExceededError("PPTX source exceeds the source byte limit")
                _validate_media_type(response.headers.get("Content-Type"))

                source = bytearray()
                async for chunk in response.aiter_bytes():
                    source.extend(chunk)
                    if len(source) > self._source_max_bytes:
                        raise PptxLimitExceededError("PPTX source exceeds the source byte limit")
        except (SpringMaterialSourceError, MaterialIngestionError):
            raise
        except httpx.HTTPError as exc:
            raise SpringMaterialSourceError(
                "presigned material download failed",
                retryable=True,
            ) from exc

        if not source:
            raise MaterialIngestionError("PPTX source is empty")
        if declared_size is not None and len(source) != declared_size:
            raise MaterialIngestionError("PPTX source download size does not match Content-Length")
        return bytes(source)


def _parse_source_reference(bucket: str, object_key: str) -> UUID:
    if bucket != SPRING_ASSET_SOURCE:
        raise MaterialIngestionError("PPTX source provider must be spring-asset")
    try:
        asset_id = UUID(object_key)
    except (AttributeError, TypeError, ValueError) as exc:
        raise MaterialIngestionError("PPTX source identity must be a UUID") from exc
    if str(asset_id) != object_key:
        raise MaterialIngestionError("PPTX source identity must use canonical lowercase UUID form")
    return asset_id


def _validated_download_url(value: str) -> httpx.URL:
    try:
        url = httpx.URL(value)
    except (TypeError, ValueError) as exc:
        raise SpringMaterialSourceError(
            "material download URL is invalid",
            retryable=False,
        ) from exc
    if url.scheme not in {"http", "https"} or not url.host or url.userinfo or url.fragment:
        raise SpringMaterialSourceError(
            "material download URL violates the HTTP capability contract",
            retryable=False,
        )
    return url


def _declared_size(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        size = int(value)
    except ValueError as exc:
        raise MaterialIngestionError("PPTX source has invalid Content-Length") from exc
    if size < 0:
        raise MaterialIngestionError("PPTX source has invalid Content-Length")
    return size


def _validate_media_type(value: str | None) -> None:
    media_type = (value or "").partition(";")[0].strip().lower()
    if media_type not in _PPTX_MEDIA_TYPES:
        raise MaterialIngestionError("PPTX source has an unsupported content type")


def _raise_issue_status(status_code: int) -> None:
    raise SpringMaterialSourceError(
        f"material download URL request failed with status {status_code}",
        status_code=status_code,
        retryable=status_code == 404 or status_code == 429 or status_code >= 500,
    )


def _raise_download_status(status_code: int) -> None:
    raise SpringMaterialSourceError(
        f"presigned material download failed with status {status_code}",
        status_code=status_code,
        retryable=status_code in {401, 403, 404, 429} or status_code >= 500,
    )
