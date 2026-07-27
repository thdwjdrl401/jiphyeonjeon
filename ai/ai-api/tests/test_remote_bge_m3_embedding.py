import asyncio
import json

import httpx
import pytest

from app.adapters.remote_bge_m3_embedding import RemoteBgeM3QueryEmbedding
from app.rag.errors import RagStreamFailure

TOKEN = "bge-runtime-token-that-is-at-least-32-characters"
REVISION = "5617a9f61b028005a4858fdac845db406aefb181"


def _payload() -> dict[str, object]:
    return {
        "model": "BAAI/bge-m3",
        "revision": REVISION,
        "dimensions": 1024,
        "normalized": True,
        "embeddings": [[1.0, *([0.0] * 1023)]],
    }


def _adapter(client: httpx.AsyncClient) -> RemoteBgeM3QueryEmbedding:
    return RemoteBgeM3QueryEmbedding(
        base_url="http://embedding",
        token=TOKEN,
        model="BAAI/bge-m3",
        revision=REVISION,
        timeout_seconds=1,
        client=client,
    )


def test_remote_embedding_sends_and_validates_bge_runtime_contract() -> None:
    async def scenario() -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/internal/v1/embeddings"
            assert request.headers["Authorization"] == f"Bearer {TOKEN}"
            assert json.loads(request.content) == {
                "model": "BAAI/bge-m3",
                "revision": REVISION,
                "texts": ["질문"],
            }
            return httpx.Response(200, json=_payload())

        client = httpx.AsyncClient(
            transport=httpx.MockTransport(handle),
            base_url="http://embedding",
        )
        try:
            vector = await _adapter(client).embed_query("질문")
            assert len(vector) == 1024
        finally:
            await client.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("status_code", "expected_code"),
    [
        (408, "EMBEDDING_TIMEOUT"),
        (429, "EMBEDDING_UNAVAILABLE"),
        (500, "EMBEDDING_UNAVAILABLE"),
        (401, "EMBEDDING_CONFIGURATION_ERROR"),
        (409, "EMBEDDING_CONFIGURATION_ERROR"),
    ],
)
def test_remote_embedding_maps_http_failures(status_code: int, expected_code: str) -> None:
    async def scenario() -> None:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(status_code, request=request)
            ),
            base_url="http://embedding",
        )
        try:
            with pytest.raises(RagStreamFailure) as error:
                await _adapter(client).embed_query("질문")
            assert error.value.code == expected_code
        finally:
            await client.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "payload_mutation",
    [
        lambda payload: payload.update(dimensions=768),
        lambda payload: payload.update(normalized=False),
        lambda payload: payload.update(embeddings=[[2.0, *([0.0] * 1023)]]),
        lambda payload: payload.update(revision="moving-revision"),
    ],
)
def test_remote_embedding_rejects_invalid_response(payload_mutation) -> None:
    async def scenario() -> None:
        payload = _payload()
        payload_mutation(payload)
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload)),
            base_url="http://embedding",
        )
        try:
            with pytest.raises(RagStreamFailure) as error:
                await _adapter(client).embed_query("질문")
            assert error.value.code == "EMBEDDING_CONFIGURATION_ERROR"
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_remote_embedding_maps_transport_timeout_and_closes_owned_client() -> None:
    async def scenario() -> None:
        def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("timed out", request=request)

        client = httpx.AsyncClient(
            transport=httpx.MockTransport(timeout),
            base_url="http://embedding",
        )
        try:
            with pytest.raises(RagStreamFailure) as error:
                await _adapter(client).embed_query("질문")
            assert error.value.code == "EMBEDDING_TIMEOUT"
        finally:
            await client.aclose()

        owned = RemoteBgeM3QueryEmbedding(
            base_url="http://embedding",
            token=TOKEN,
            model="BAAI/bge-m3",
            revision=REVISION,
            timeout_seconds=1,
        )
        owned_client = owned._client
        await owned.aclose()
        assert owned_client.is_closed

    asyncio.run(scenario())
