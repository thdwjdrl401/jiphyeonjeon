from __future__ import annotations

import json

import httpx
import pytest

from app.adapters.remote_bge_embedding import (
    RemoteBgeM3EmbeddingModel,
    RemoteEmbeddingError,
)
from app.domain import EmbeddingContractError


REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
TOKEN = "x" * 32


def _vector(index: int = 0) -> list[float]:
    vector = [0.0] * 1024
    vector[index] = 1.0
    return vector


def _response(texts: list[str], **overrides: object) -> dict[str, object]:
    return {
        "model": "BAAI/bge-m3",
        "revision": REVISION,
        "dimensions": 1024,
        "normalized": True,
        "embeddings": [_vector(index) for index, _text in enumerate(texts)],
        **overrides,
    }


async def test_batches_at_four_and_preserves_request_and_response_order() -> None:
    requests: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        requests.append(
            {
                "path": request.url.path,
                "authorization": request.headers.get("Authorization"),
                "payload": payload,
            }
        )
        return httpx.Response(200, json=_response(payload["texts"]))

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://bge-runtime:8020",
    ) as client:
        adapter = RemoteBgeM3EmbeddingModel(
            client,
            internal_token=TOKEN,
            model_revision=REVISION,
        )
        embeddings = await adapter.embed(["a", "b", "c", "d", "e"])

    assert [request["payload"]["texts"] for request in requests] == [
        ["a", "b", "c", "d"],
        ["e"],
    ]
    assert all(request["path"] == "/internal/v1/embeddings" for request in requests)
    assert all(request["authorization"] == f"Bearer {TOKEN}" for request in requests)
    assert embeddings == [_vector(0), _vector(1), _vector(2), _vector(3), _vector(0)]


@pytest.mark.parametrize(
    "overrides",
    [
        {"model": "other"},
        {"revision": "0" * 40},
        {"dimensions": 768},
        {"normalized": False},
        {"embeddings": []},
        {"embeddings": [[1.0]]},
        {"embeddings": [[0.0] * 1024]},
        {"unexpected": True},
    ],
)
async def test_rejects_response_contract_mismatch(overrides: dict[str, object]) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_response(["text"], **overrides))

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://bge-runtime:8020",
    ) as client:
        adapter = RemoteBgeM3EmbeddingModel(
            client,
            internal_token=TOKEN,
            model_revision=REVISION,
        )
        with pytest.raises(EmbeddingContractError):
            await adapter.embed(["text"])


@pytest.mark.parametrize("status_code", [400, 409, 413, 422])
async def test_treats_request_contract_rejection_as_permanent(status_code: int) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(status_code)),
        base_url="http://bge-runtime:8020",
    ) as client:
        adapter = RemoteBgeM3EmbeddingModel(
            client,
            internal_token=TOKEN,
            model_revision=REVISION,
        )
        with pytest.raises(EmbeddingContractError):
            await adapter.embed(["text"])


@pytest.mark.parametrize(
    ("status_code", "retryable"),
    [(401, False), (429, True), (500, True)],
)
async def test_classifies_remote_http_failures(status_code: int, retryable: bool) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(status_code)),
        base_url="http://bge-runtime:8020",
    ) as client:
        adapter = RemoteBgeM3EmbeddingModel(
            client,
            internal_token=TOKEN,
            model_revision=REVISION,
        )
        with pytest.raises(RemoteEmbeddingError) as caught:
            await adapter.embed(["text"])

    assert caught.value.status_code == status_code
    assert caught.value.retryable is retryable


async def test_classifies_network_failure_as_retryable_without_leaking_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://bge-runtime:8020",
    ) as client:
        adapter = RemoteBgeM3EmbeddingModel(
            client,
            internal_token=TOKEN,
            model_revision=REVISION,
        )
        with pytest.raises(RemoteEmbeddingError) as caught:
            await adapter.embed(["text"])

    assert caught.value.status_code is None
    assert caught.value.retryable is True
    assert TOKEN not in str(caught.value)


@pytest.mark.parametrize("texts", [[], [""], [" "], ["x" * 4_001]])
async def test_rejects_invalid_input_without_sending_request(texts: list[str]) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=_response(["text"]))

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://bge-runtime:8020",
    ) as client:
        adapter = RemoteBgeM3EmbeddingModel(
            client,
            internal_token=TOKEN,
            model_revision=REVISION,
        )
        with pytest.raises(EmbeddingContractError):
            await adapter.embed(texts)

    assert calls == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"internal_token": "short"},
        {"model_revision": "main"},
        {"max_batch_size": 5},
        {"request_timeout_seconds": 0},
    ],
)
async def test_rejects_invalid_adapter_configuration(overrides: dict[str, object]) -> None:
    arguments: dict[str, object] = {
        "internal_token": TOKEN,
        "model_revision": REVISION,
        **overrides,
    }

    async with httpx.AsyncClient(base_url="http://bge-runtime:8020") as client:
        with pytest.raises(ValueError):
            RemoteBgeM3EmbeddingModel(
                client,
                **arguments,  # type: ignore[arg-type]
            )
