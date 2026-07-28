from __future__ import annotations

import json

import httpx
import pytest

from scripts.smoke_remote_bge import run_probe


_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
_TOKEN = "x" * 32


def _vector(index: int, *, scale: float = 1.0) -> list[float]:
    vector = [0.0] * 1024
    vector[index] = scale
    return vector


async def test_probes_remote_runtime_without_exposing_payload_in_result() -> None:
    requests: list[tuple[str, str | None, dict[str, object] | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content) if request.content else None
        requests.append((request.url.path, request.headers.get("Authorization"), payload))
        if request.url.path == "/readyz":
            return httpx.Response(200, json={"status": "ready", "service": "bge-runtime"})
        assert payload is not None
        return httpx.Response(
            200,
            json={
                "model": "BAAI/bge-m3",
                "revision": _REVISION,
                "dimensions": 1024,
                "normalized": True,
                "embeddings": [_vector(0), _vector(1)],
            },
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://127.0.0.1:18020",
    ) as client:
        result = await run_probe(
            client,
            internal_token=_TOKEN,
            model_revision=_REVISION,
            timeout_seconds=1,
        )

    assert [request[0] for request in requests] == ["/readyz", "/internal/v1/embeddings"]
    assert requests[0][1] is None
    assert requests[1][1] == f"Bearer {_TOKEN}"
    assert requests[1][2] == {
        "model": "BAAI/bge-m3",
        "revision": _REVISION,
        "texts": [
            "EC2에서 GPU BGE reverse tunnel 통신을 확인합니다.",
            "LiveClass checks a second remote embedding in request order.",
        ],
    }
    assert result["status"] == "ok"
    assert result["dimensions"] == [1024]
    assert result["count"] == 2
    assert "embeddings" not in result
    assert _TOKEN not in json.dumps(result)


async def test_stops_before_embedding_when_runtime_is_not_ready() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(503, json={"status": "not_ready", "service": "bge-runtime"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://127.0.0.1:18020",
    ) as client:
        with pytest.raises(RuntimeError, match=r"not ready \(status=503\)"):
            await run_probe(
                client,
                internal_token=_TOKEN,
                model_revision=_REVISION,
                timeout_seconds=1,
            )

    assert paths == ["/readyz"]


async def test_rejects_vectors_that_only_claim_to_be_normalized() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/readyz":
            return httpx.Response(200, json={"status": "ready", "service": "bge-runtime"})
        return httpx.Response(
            200,
            json={
                "model": "BAAI/bge-m3",
                "revision": _REVISION,
                "dimensions": 1024,
                "normalized": True,
                "embeddings": [_vector(0, scale=2.0), _vector(1, scale=2.0)],
            },
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://127.0.0.1:18020",
    ) as client:
        with pytest.raises(RuntimeError, match="normalization tolerance"):
            await run_probe(
                client,
                internal_token=_TOKEN,
                model_revision=_REVISION,
                timeout_seconds=1,
            )
