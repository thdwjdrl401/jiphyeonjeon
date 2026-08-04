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
# Annotation snapshots go through the same endpoint but are PNG crops, not decks
# (ADR-0043 §11.2).
_ANNOTATION_MEDIA_TYPES = frozenset({"image/png", "application/octet-stream"})
DEFAULT_ANNOTATION_IMAGE_MAX_BYTES = 4 * 1024 * 1024


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
    """Issue one signed capability URL and immediately stream its bounded asset bytes.

    Serves both PPTX decks and annotation snapshot images: ADR-0043 §11.2 reuses this endpoint
    rather than opening a second one, so only the media types and byte ceiling differ.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        signer: SpringHmacSigner,
        *,
        source_max_bytes: int,
        annotation_image_max_bytes: int = DEFAULT_ANNOTATION_IMAGE_MAX_BYTES,
        issue_timeout_seconds: float = 5.0,
        download_timeout_seconds: float = 30.0,
    ) -> None:
        if source_max_bytes <= 0:
            raise ValueError("source_max_bytes must be positive")
        if annotation_image_max_bytes <= 0:
            raise ValueError("annotation_image_max_bytes must be positive")
        if not 0 < issue_timeout_seconds <= 120:
            raise ValueError("issue_timeout_seconds must be between 0 and 120")
        if not 0 < download_timeout_seconds <= 600:
            raise ValueError("download_timeout_seconds must be between 0 and 600")
        self._client = client
        self._signer = signer
        self._source_max_bytes = source_max_bytes
        self._annotation_image_max_bytes = annotation_image_max_bytes
        self._issue_timeout_seconds = issue_timeout_seconds
        self._download_timeout_seconds = download_timeout_seconds

    async def read_pptx(self, bucket: str, object_key: str) -> bytes:
        asset_id = _parse_source_reference(bucket, object_key)
        return await self._read_asset(
            asset_id,
            media_types=_PPTX_MEDIA_TYPES,
            max_bytes=self._source_max_bytes,
            what="PPTX source",
        )

    async def read_annotation_image(self, asset_id: UUID) -> bytes:
        if not isinstance(asset_id, UUID):
            raise MaterialIngestionError("annotation image identity must be a UUID")
        return await self._read_asset(
            asset_id,
            media_types=_ANNOTATION_MEDIA_TYPES,
            max_bytes=self._annotation_image_max_bytes,
            what="annotation image",
        )

    async def _read_asset(
        self,
        asset_id: UUID,
        *,
        media_types: frozenset[str],
        max_bytes: int,
        what: str,
    ) -> bytes:
        body = json.dumps(
            {"assetId": str(asset_id)},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        download_url = await self._issue_download_url(body)
        return await self._download(
            download_url, media_types=media_types, max_bytes=max_bytes, what=what
        )

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

    async def _download(
        self,
        download_url: httpx.URL,
        *,
        media_types: frozenset[str],
        max_bytes: int,
        what: str,
    ) -> bytes:
        try:
            async with self._client.stream(
                "GET",
                download_url,
                timeout=self._download_timeout_seconds,
                follow_redirects=False,
            ) as response:
                if response.status_code != httpx.codes.OK:
                    _raise_download_status(response.status_code)
                declared_size = _declared_size(response.headers.get("Content-Length"), what)
                if declared_size is not None and declared_size > max_bytes:
                    raise PptxLimitExceededError(f"{what} exceeds the source byte limit")
                _validate_media_type(response.headers.get("Content-Type"), media_types, what)

                source = bytearray()
                async for chunk in response.aiter_bytes():
                    source.extend(chunk)
                    # Enforced on received bytes too: a missing or lying Content-Length must
                    # not become an unbounded read.
                    if len(source) > max_bytes:
                        raise PptxLimitExceededError(f"{what} exceeds the source byte limit")
        except (SpringMaterialSourceError, MaterialIngestionError):
            raise
        except httpx.HTTPError as exc:
            raise SpringMaterialSourceError(
                "presigned material download failed",
                retryable=True,
            ) from exc

        if not source:
            raise MaterialIngestionError(f"{what} is empty")
        if declared_size is not None and len(source) != declared_size:
            raise MaterialIngestionError(f"{what} download size does not match Content-Length")
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


def _declared_size(value: str | None, what: str) -> int | None:
    if value is None:
        return None
    try:
        size = int(value)
    except ValueError as exc:
        raise MaterialIngestionError(f"{what} has invalid Content-Length") from exc
    if size < 0:
        raise MaterialIngestionError(f"{what} has invalid Content-Length")
    return size


def _validate_media_type(value: str | None, media_types: frozenset[str], what: str) -> None:
    media_type = (value or "").partition(";")[0].strip().lower()
    if media_type not in media_types:
        raise MaterialIngestionError(f"{what} has an unsupported content type")


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
