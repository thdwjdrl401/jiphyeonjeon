from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ConnectError, Request

from app import wiring
from app.config import Settings
from app.contracts import PptxEmbedJob, parse_material_job
from app.runtime import WorkerState
from app.wiring import PptxIngestionRuntime, PptxRuntimeConfigurationError


DATABASE_URL = "postgresql+asyncpg://ai:secret@localhost/liveclass"
REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
CALLBACK_SECRET = "dev-ai-callback-secret"
BGE_TOKEN = "x" * 32
RABBITMQ_URL = "amqp://liveclass:secret@localhost:5672/"


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

    runtime = wiring.build_pptx_ingestion_runtime(_settings(bge_readiness_timeout_seconds=7.5))

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
    assert indexer_options["key_term_extractor"] is None
    assert indexer_options["key_term_storage"]._engine is engine
    assert runtime.index_pptx_material.name == "indexer"
    assert runtime.callback_client.name == "callback"
    assert runtime._bge_readiness_timeout_seconds == 7.5
    assert runtime._key_term_extractor is None


def test_key_term_extraction_enabled_builds_and_wires_the_gms_extractor(monkeypatch) -> None:
    captured: dict[str, object] = {}
    engine = FakeEngine()
    extractor = SimpleNamespace(name="key-term-extractor")

    def fake_gms_extractor(**kwargs: object) -> object:
        captured["gms_extractor"] = kwargs
        return extractor

    monkeypatch.setattr(wiring, "AsyncClient", FakeHttpClient)
    monkeypatch.setattr(wiring, "create_async_engine", lambda *_args, **_kwargs: engine)
    monkeypatch.setattr(wiring, "GmsKeyTermExtractor", fake_gms_extractor)
    monkeypatch.setattr(
        wiring,
        "IndexPptxMaterial",
        lambda *args, **kwargs: SimpleNamespace(name="indexer", options=kwargs),
    )

    runtime = wiring.build_pptx_ingestion_runtime(
        _settings(key_term_extraction_enabled=True, gms_api_key="x" * 32)
    )

    assert captured["gms_extractor"] == {
        "api_key": "x" * 32,
        "model": "gpt-4.1",
        "max_output_tokens": 1_024,
        "max_prompt_chars": 100_000,
        "timeout_seconds": 55.0,
    }
    assert runtime.index_pptx_material.options["key_term_extractor"] is extractor
    assert runtime._key_term_extractor is extractor


async def test_runtime_closes_the_key_term_extractor_when_configured(monkeypatch) -> None:
    engine = FakeEngine()
    extractor = SimpleNamespace(aclose=AsyncMock())
    monkeypatch.setattr(wiring, "AsyncClient", FakeHttpClient)
    monkeypatch.setattr(wiring, "create_async_engine", lambda *_args, **_kwargs: engine)
    monkeypatch.setattr(wiring, "GmsKeyTermExtractor", lambda **_kwargs: extractor)
    monkeypatch.setattr(wiring, "IndexPptxMaterial", lambda *_args, **_kwargs: object())

    runtime = wiring.build_pptx_ingestion_runtime(
        _settings(key_term_extraction_enabled=True, gms_api_key="x" * 32)
    )
    await runtime.aclose()

    extractor.aclose.assert_awaited_once()


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


async def test_runtime_readiness_requires_database_and_bge() -> None:
    engine = MagicMock()
    connection = AsyncMock()
    engine.connect.return_value.__aenter__.return_value = connection
    embedding_client = SimpleNamespace(get=AsyncMock())
    runtime = PptxIngestionRuntime(
        index_pptx_material=object(),  # type: ignore[arg-type]
        delete_material_index=object(),  # type: ignore[arg-type]
        callback_client=object(),  # type: ignore[arg-type]
        tenant_id="liveclass",
        model_revision=REVISION,
        chunk_max_chars=1_200,
        _spring_client=object(),  # type: ignore[arg-type]
        _embedding_client=embedding_client,  # type: ignore[arg-type]
        _database_engine=engine,
        _bge_readiness_timeout_seconds=2.0,
    )

    connection.scalar.return_value = 0
    assert await runtime.dependencies_ready() is False
    embedding_client.get.assert_not_awaited()

    connection.scalar.return_value = 1
    embedding_client.get.return_value = SimpleNamespace(
        status_code=200,
        json=lambda: {
            "status": "ready",
            "service": "bge-runtime",
            "metadata": {"model": "BAAI/bge-m3"},
        },
    )
    assert await runtime.dependencies_ready() is True
    embedding_client.get.assert_awaited_once_with("/readyz", timeout=2.0)
    embedding_client.get.return_value = SimpleNamespace(
        status_code=200,
        json=lambda: {"status": "not_ready", "service": "bge-runtime"},
    )
    assert await runtime.dependencies_ready() is False

    embedding_client.get.return_value = SimpleNamespace(status_code=503)
    assert await runtime.dependencies_ready() is False

    embedding_client.get.return_value = SimpleNamespace(
        status_code=200,
        json=MagicMock(side_effect=ValueError("invalid json")),
    )
    assert await runtime.dependencies_ready() is False

    embedding_client.get.side_effect = ConnectError(
        "offline",
        request=Request("GET", "http://127.0.0.1:18020/readyz"),
    )
    assert await runtime.dependencies_ready() is False


def test_disabled_worker_keeps_management_only_runtime(monkeypatch) -> None:
    monkeypatch.setattr(
        wiring,
        "build_pptx_ingestion_runtime",
        lambda _settings: pytest.fail("disabled worker must not build external adapters"),
    )

    runtime = wiring.build_worker_runtime(_settings(), WorkerState())

    assert runtime._runner is None


def test_enabled_worker_requires_rabbitmq_url_before_building_resources(monkeypatch) -> None:
    monkeypatch.setattr(
        wiring,
        "build_pptx_ingestion_runtime",
        lambda _settings: pytest.fail("missing RabbitMQ URL must fail first"),
    )

    with pytest.raises(PptxRuntimeConfigurationError, match="AI_WORKER_RABBITMQ_URL"):
        wiring.build_worker_runtime(
            _settings(material_ingestion_enabled=True),
            WorkerState(),
        )


def test_enabled_worker_wires_consumer_handler_readiness_and_cleanup(monkeypatch) -> None:
    captured = {}
    ingestion_runtime = SimpleNamespace(
        dependencies_ready=AsyncMock(return_value=True),
        aclose=AsyncMock(),
    )
    job_handler = object()
    consumer = object()
    monkeypatch.setattr(
        wiring,
        "build_pptx_ingestion_runtime",
        lambda _settings: ingestion_runtime,
    )
    monkeypatch.setattr(wiring, "MaterialJobHandler", lambda runtime: job_handler)

    def fake_consumer(url, handler, **options):
        captured.update(url=url, handler=handler, options=options)
        return consumer

    monkeypatch.setattr(wiring, "RabbitMaterialConsumer", fake_consumer)
    state = WorkerState()

    runtime = wiring.build_worker_runtime(
        _settings(
            material_ingestion_enabled=True,
            rabbitmq_url=RABBITMQ_URL,
        ),
        state,
    )

    assert captured["url"] == RABBITMQ_URL
    assert captured["handler"] is job_handler
    assert captured["options"]["readiness_check"] is ingestion_runtime.dependencies_ready
    captured["options"]["on_ready"](True)
    assert state.ready is True
    assert runtime._runner is consumer
