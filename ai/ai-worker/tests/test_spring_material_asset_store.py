from __future__ import annotations

import base64
import hashlib
import hmac

import httpx
import pytest

from app.adapters.spring_hmac import SpringHmacSigner
from app.adapters.spring_material_asset_store import (
    SpringMaterialSourceError,
    SpringPresignedPptxAssetStore,
)
from app.application import SPRING_ASSET_SOURCE
from app.domain import MaterialIngestionError, PptxLimitExceededError


ASSET_ID = "550e8400-e29b-41d4-a716-446655440001"
SECRET = "dev-ai-callback-secret"
PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _store(
    client: httpx.AsyncClient, *, source_max_bytes: int = 10
) -> SpringPresignedPptxAssetStore:
    return SpringPresignedPptxAssetStore(
        client,
        SpringHmacSigner(SECRET),
        source_max_bytes=source_max_bytes,
    )


async def test_signs_exact_body_then_immediately_downloads_bounded_pptx() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/internal/ai/materials/download-url":
            expected_body = b'{"assetId":"550e8400-e29b-41d4-a716-446655440001"}'
            expected_signature = base64.b64encode(
                hmac.new(SECRET.encode(), expected_body, hashlib.sha256).digest()
            ).decode()
            assert request.content == expected_body
            assert request.headers["Content-Type"] == "application/json"
            assert request.headers["X-Signature"] == expected_signature
            return httpx.Response(
                200,
                json={"url": "http://storage/material.pptx?X-Amz-Signature=signed"},
            )
        assert request.url.host == "storage"
        assert request.headers.get("X-Signature") is None
        return httpx.Response(
            200,
            content=b"pptx",
            headers={"Content-Type": PPTX_MEDIA_TYPE},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        source = await _store(client).read_pptx(SPRING_ASSET_SOURCE, ASSET_ID)

    assert source == b"pptx"
    assert [request.method for request in requests] == ["POST", "GET"]


@pytest.mark.parametrize(
    ("status_code", "retryable"),
    [(401, False), (404, True), (429, True), (500, True)],
)
async def test_classifies_download_url_issue_failures(status_code: int, retryable: bool) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(status_code)),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(SpringMaterialSourceError) as caught:
            await _store(client).read_pptx(SPRING_ASSET_SOURCE, ASSET_ID)

    assert caught.value.status_code == status_code
    assert caught.value.retryable is retryable
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize("status_code", [401, 403, 404, 429, 500])
async def test_treats_expired_or_unavailable_presigned_download_as_retryable(
    status_code: int,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"url": "https://storage/material.pptx?secret=1"})
        return httpx.Response(status_code)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(SpringMaterialSourceError) as caught:
            await _store(client).read_pptx(SPRING_ASSET_SOURCE, ASSET_ID)

    assert caught.value.status_code == status_code
    assert caught.value.retryable is True
    assert "secret=1" not in str(caught.value)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"url": "file:///tmp/material.pptx"},
        {"url": "https://user:pass@storage/material.pptx"},
        {"url": "https://storage/material.pptx#fragment"},
        {"url": "https://storage/material.pptx", "unexpected": True},
    ],
)
async def test_rejects_invalid_download_url_contract_without_get(
    payload: dict[str, object],
) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(SpringMaterialSourceError) as caught:
            await _store(client).read_pptx(SPRING_ASSET_SOURCE, ASSET_ID)

    assert caught.value.retryable is False
    assert calls == 1


@pytest.mark.parametrize(
    ("headers", "content", "error"),
    [
        (
            {"Content-Type": PPTX_MEDIA_TYPE, "Content-Length": "11"},
            b"large",
            PptxLimitExceededError,
        ),
        ({"Content-Type": "text/plain"}, b"pptx", MaterialIngestionError),
        ({"Content-Type": PPTX_MEDIA_TYPE, "Content-Length": "5"}, b"four", MaterialIngestionError),
        (
            {"Content-Type": PPTX_MEDIA_TYPE, "Content-Length": "invalid"},
            b"pptx",
            MaterialIngestionError,
        ),
        ({"Content-Type": PPTX_MEDIA_TYPE}, b"", MaterialIngestionError),
    ],
)
async def test_rejects_invalid_size_media_type_or_empty_download(
    headers: dict[str, str],
    content: bytes,
    error: type[Exception],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"url": "https://storage/material.pptx"})
        return httpx.Response(200, headers=headers, content=content)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(error):
            await _store(client).read_pptx(SPRING_ASSET_SOURCE, ASSET_ID)


async def test_enforces_streamed_limit_when_content_length_is_absent() -> None:
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"1234"
            yield b"5678"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"url": "https://storage/material.pptx"})
        return httpx.Response(
            200,
            headers={"Content-Type": PPTX_MEDIA_TYPE},
            stream=Stream(),
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(PptxLimitExceededError):
            await _store(client, source_max_bytes=7).read_pptx(SPRING_ASSET_SOURCE, ASSET_ID)


@pytest.mark.parametrize(
    ("provider", "identity"),
    [
        ("materials", ASSET_ID),
        (SPRING_ASSET_SOURCE, "not-a-uuid"),
        (SPRING_ASSET_SOURCE, ASSET_ID.upper()),
    ],
)
async def test_rejects_noncanonical_source_reference_before_http(
    provider: str,
    identity: str,
) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(MaterialIngestionError):
            await _store(client).read_pptx(provider, identity)

    assert calls == 0


async def test_classifies_network_failure_without_leaking_secret() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://spring.internal",
    ) as client:
        with pytest.raises(SpringMaterialSourceError) as caught:
            await _store(client).read_pptx(SPRING_ASSET_SOURCE, ASSET_ID)

    assert caught.value.status_code is None
    assert caught.value.retryable is True
    assert SECRET not in str(caught.value)
