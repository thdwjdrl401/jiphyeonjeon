from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app import wiring
from app.config import Settings
from app.contracts import PptxEmbedJob, parse_material_job
from app.wiring import PptxRuntimeConfigurationError


DATABASE_URL = "postgresql+asyncpg://ai:secret@localhost/liveclass"
REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
CALLBACK_SECRET = "dev-ai-callback-secret"
BGE_TOKEN = "x" * 32


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "instance_id": "worker-1",
        "database_url": DATABASE_URL,
        "spring_hmac_secret": CALLBACK_SECRET,
        "bge_internal_token": BGE_TOKEN,
        **overrides,
    }
    return Settings(**values)


def _job() -> PptxEmbedJob:
    job = parse_material_job(
        json.dumps(
            {
                "taskType": "PPTX_EMBED",
                "materialId": "550e8400-e29b-41d4-a716-446655440000",
                "assetId": "550e8400-e29b-41d4-a716-446655440001",
                "lessonId": "550e8400-e29b-41d4-a716-446655440002",
                "curriculumId": "550e8400-e29b-41d4-a716-446655440003",
                "fileName": "deck.pptx",
                "policy": {"embedModel": "bge-m3"},
                "contractVersion": 1,
            },
            separators=(",", ":"),
        ).encode()
    )
    assert isinstance(job, PptxEmbedJob)
    return job


class FakeHttpClient:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.closed = 0

    async def aclose(self) -> None:
        self.closed += 1


class FakeEngine:
    def __init__(self) -> None:
        self.disposed = 0

    async def dispose(self) -> None:
        self.disposed += 1


def test_builds_spring_bge_pgvector_and_use_case_with_shared_dependencies(monkeypatch) -> None:
    captured: dict[str, object] = {}
    clients: list[FakeHttpClient] = []
    engine = FakeEngine()

    def fake_http_client(**kwargs: object) -> FakeHttpClient:
        client = FakeHttpClient(**kwargs)
        clients.append(client)
        return client

    def fake_source(client: object, signer: object, **kwargs: object) -> object:
        captured["source"] = (client, signer, kwargs)
        return SimpleNamespace(name="source")

    def fake_embedding(client: object, **kwargs: object) -> object:
        captured["embedding"] = (client, kwargs)
        return SimpleNamespace(name="embedding")

    def fake_callback(client: object, signer: object, **kwargs: object) -> object:
        captured["callback"] = (client, signer, kwargs)
        return SimpleNamespace(name="callback")

    def fake_indexer(*args: object, **kwargs: object) -> object:
        captured["indexer"] = (args, kwargs)
        return SimpleNamespace(name="indexer")

    monkeypatch.setattr(wiring, "AsyncClient", fake_http_client)
    monkeypatch.setattr(wiring, "create_async_engine", lambda *_args, **_kwargs: engine)
    monkeypatch.setattr(wiring, "SpringPresignedPptxAssetStore", fake_source)
    monkeypatch.setattr(wiring, "RemoteBgeM3EmbeddingModel", fake_embedding)
    monkeypatch.setattr(wiring, "SpringMaterialCallbackClient", fake_callback)
    monkeypatch.setattr(wiring, "IndexPptxMaterial", fake_indexer)

    runtime = wiring.build_pptx_ingestion_runtime(_settings())

    assert [client.kwargs for client in clients] == [
        {"base_url": "http://127.0.0.1:8080"},
        {"base_url": "http://127.0.0.1:8020"},
    ]
    source_client, signer, source_options = captured["source"]
    callback_client, callback_signer, callback_options = captured["callback"]
    assert source_client is callback_client is clients[0]
    assert signer is callback_signer
    assert source_options == {
        "source_max_bytes": 50 * 1024 * 1024,
        "issue_timeout_seconds": 5.0,
        "download_timeout_seconds": 30.0,
    }
    assert callback_options == {"timeout_seconds": 5.0}
    embedding_client, embedding_options = captured["embedding"]
    assert embedding_client is clients[1]
    assert embedding_options == {
        "internal_token": BGE_TOKEN,
        "model_name": "BAAI/bge-m3",
        "model_revision": REVISION,
        "max_batch_size": 4,
        "max_text_chars": 4_000,
        "request_timeout_seconds": 10.0,
    }
    indexer_args, indexer_options = captured["indexer"]
    assert indexer_args[0].name == "source"
    assert indexer_args[1].name == "embedding"
    assert indexer_args[2]._engine is engine
    assert indexer_options["validation_limits"].source_max_bytes == 50 * 1024 * 1024
    assert indexer_options["chunk_max_chars"] == 1_200
    assert runtime.index_pptx_material.name == "indexer"
    assert runtime.callback_client.name == "callback"


def test_runtime_maps_wire_job_with_its_validated_configuration(monkeypatch) -> None:
    engine = FakeEngine()
    monkeypatch.setattr(wiring, "AsyncClient", FakeHttpClient)
    monkeypatch.setattr(wiring, "create_async_engine", lambda *_args, **_kwargs: engine)
    monkeypatch.setattr(wiring, "IndexPptxMaterial", lambda *_args, **_kwargs: object())

    runtime = wiring.build_pptx_ingestion_runtime(_settings())
    material = runtime.material_for(_job())

    assert material.tenant_id == "liveclass"
    assert material.model_revision == REVISION
    assert material.chunk_strategy == "slide-max-1200-v1"
    assert material.source_bucket == "spring-asset"
    assert material.source_object_key == "550e8400-e29b-41d4-a716-446655440001"


@pytest.mark.parametrize("missing", ["spring_hmac_secret", "bge_internal_token"])
def test_wiring_fails_before_resource_creation_when_secret_is_missing(
    monkeypatch,
    missing: str,
) -> None:
    calls = 0

    def fake_http_client(**_kwargs: object) -> object:
        nonlocal calls
        calls += 1
        return object()

    monkeypatch.setattr(wiring, "AsyncClient", fake_http_client)

    with pytest.raises(PptxRuntimeConfigurationError, match="is required"):
        wiring.build_pptx_ingestion_runtime(_settings(**{missing: None}))

    assert calls == 0


async def test_runtime_closes_both_http_clients_and_database_engine_once(monkeypatch) -> None:
    engine = FakeEngine()
    clients: list[FakeHttpClient] = []

    def fake_http_client(**kwargs: object) -> FakeHttpClient:
        client = FakeHttpClient(**kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(wiring, "AsyncClient", fake_http_client)
    monkeypatch.setattr(wiring, "create_async_engine", lambda *_args, **_kwargs: engine)
    monkeypatch.setattr(wiring, "IndexPptxMaterial", lambda *_args, **_kwargs: object())

    runtime = wiring.build_pptx_ingestion_runtime(_settings())
    await runtime.aclose()
    await runtime.aclose()

    assert [client.closed for client in clients] == [1, 1]
    assert engine.disposed == 1
