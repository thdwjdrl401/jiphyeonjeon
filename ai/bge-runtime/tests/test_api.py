from __future__ import annotations

import asyncio
import threading
from collections.abc import Sequence

import httpx
import pytest

from app import main
from app.config import Settings
from app.embedding import BGE_M3_REVISION, BgeM3EmbeddingModel
from app.main import create_app

_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"


def _vector(index: int = 0) -> list[float]:
    vector = [0.0] * 1024
    vector[index] = 1.0
    return vector


class FakeEmbedding:
    def __init__(self) -> None:
        self.warmup_calls = 0
        self.requests: list[list[str]] = []

    async def warmup(self) -> None:
        self.warmup_calls += 1

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        self.requests.append(list(texts))
        return [_vector(index) for index, _text in enumerate(texts)]


def _settings(**overrides: object) -> Settings:
    return Settings(internal_token="x" * 32, **overrides)


def _payload(settings: Settings, texts: list[str] | None = None) -> dict[str, object]:
    return {
        "model": settings.model,
        "revision": settings.revision,
        "texts": ["질문"] if texts is None else texts,
    }


async def test_health_readiness_and_authenticated_embedding_contract() -> None:
    settings = _settings()
    embedding = FakeEmbedding()
    app = create_app(settings, embedding)

    transport = httpx.ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client,
    ):
        assert (await client.get("/healthz")).json() == {
            "status": "ok",
            "service": "bge-runtime",
        }
        assert (await client.get("/readyz")).json() == {
            "status": "ready",
            "service": "bge-runtime",
        }
        response = await client.post(
            "/internal/v1/embeddings",
            headers={"Authorization": f"Bearer {settings.internal_token.get_secret_value()}"},
            json=_payload(settings, ["첫 번째", "두 번째"]),
        )

    assert response.status_code == 200
    assert response.json() == {
        "model": "BAAI/bge-m3",
        "revision": _REVISION,
        "dimensions": 1024,
        "normalized": True,
        "embeddings": [_vector(0), _vector(1)],
    }
    assert embedding.warmup_calls == 1
    assert embedding.requests == [["첫 번째", "두 번째"]]


async def test_readiness_is_unavailable_before_lifespan_startup() -> None:
    app = create_app(_settings(), FakeEmbedding())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "service": "bge-runtime"}


@pytest.mark.parametrize("authorization", [None, "Basic abc", "Bearer wrong"])
async def test_embedding_endpoint_rejects_missing_or_wrong_authentication(
    authorization: str | None,
) -> None:
    settings = _settings()
    headers = {} if authorization is None else {"Authorization": authorization}

    app = create_app(settings, FakeEmbedding())
    transport = httpx.ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client,
    ):
        response = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json=_payload(settings),
        )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_authentication_precedes_request_body_validation() -> None:
    app = create_app(_settings(max_request_body_bytes=8), FakeEmbedding())
    transport = httpx.ASGITransport(app=app)

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client,
    ):
        response = await client.post("/internal/v1/embeddings", content=b"x" * 64)

    assert response.status_code == 401


async def test_embedding_endpoint_bounds_declared_and_chunked_body_before_parsing() -> None:
    settings = _settings(max_request_body_bytes=32)
    embedding = FakeEmbedding()
    app = create_app(settings, embedding)
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": "Bearer " + settings.internal_token.get_secret_value()}

    async def oversized_chunks():
        yield b"x" * 20
        yield b"y" * 20

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
    ):
        declared = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            content=b"x" * 33,
        )
        chunked = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            content=oversized_chunks(),
        )

    assert declared.status_code == 413
    assert chunked.status_code == 413
    assert embedding.requests == []


async def test_slow_request_body_times_out_and_releases_admission() -> None:
    settings = _settings(
        max_inflight_requests=1,
        max_request_body_bytes=1_024,
        request_body_timeout_seconds=0.01,
    )
    embedding = FakeEmbedding()
    app = create_app(settings, embedding)
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": "Bearer " + settings.internal_token.get_secret_value()}

    async def slow_chunks():
        yield b"{"
        await asyncio.sleep(0.05)
        yield b"}"

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
    ):
        timed_out = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            content=slow_chunks(),
        )
        recovered = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json=_payload(settings),
        )

    assert timed_out.status_code == 408
    assert recovered.status_code == 200


async def test_embedding_endpoint_enforces_model_batch_text_and_schema_limits() -> None:
    settings = _settings(batch_size=1, max_batch_size=1, max_text_chars=3)
    headers = {"Authorization": "Bearer " + settings.internal_token.get_secret_value()}

    app = create_app(settings, FakeEmbedding())
    transport = httpx.ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client,
    ):
        mismatch = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json={**_payload(settings), "revision": "wrong"},
        )
        oversized_batch = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json=_payload(settings, ["가", "나"]),
        )
        invalid_text = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json=_payload(settings, ["가나다라"]),
        )
        blank_text = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json=_payload(settings, [" "]),
        )
        extra_field = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json={**_payload(settings), "unexpected": True},
        )
        empty_texts = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json=_payload(settings, []),
        )

    assert mismatch.status_code == 409
    assert oversized_batch.status_code == 413
    assert invalid_text.status_code == 422
    assert blank_text.status_code == 422
    assert extra_field.status_code == 422
    assert empty_texts.status_code == 422


async def test_embedding_endpoint_rejects_work_beyond_bounded_inflight_limit() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    class BlockingEmbedding(FakeEmbedding):
        async def embed(self, texts: Sequence[str]) -> list[list[float]]:
            started.set()
            await release.wait()
            return await super().embed(texts)

    settings = _settings(max_inflight_requests=1)
    app = create_app(settings, BlockingEmbedding())
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": "Bearer " + settings.internal_token.get_secret_value()}

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = asyncio.create_task(
            client.post(
                "/internal/v1/embeddings",
                headers=headers,
                json=_payload(settings),
            )
        )
        await asyncio.wait_for(started.wait(), timeout=1)
        overloaded = await client.post(
            "/internal/v1/embeddings",
            headers=headers,
            json=_payload(settings),
        )
        release.set()
        completed = await asyncio.wait_for(first, timeout=1)

    assert overloaded.status_code == 429
    assert overloaded.headers["retry-after"] == "1"
    assert completed.status_code == 200


async def test_cancelled_http_request_keeps_admission_until_gpu_thread_finishes() -> None:
    encode_started = threading.Event()
    release_encode = threading.Event()

    class BlockingEncoded:
        def encode(self, texts: list[str], **kwargs: object) -> list[list[float]]:
            encode_started.set()
            if not release_encode.wait(timeout=2):
                raise TimeoutError("test did not release inference")
            return [_vector() for _ in texts]

    model = BgeM3EmbeddingModel(
        "BAAI/bge-m3",
        BGE_M3_REVISION,
        device="cuda",
        batch_size=1,
        loader=lambda *args, **kwargs: BlockingEncoded(),
        device_validator=lambda _: None,
    )

    class RuntimeWithoutWarmup:
        async def warmup(self) -> None:
            pass

        async def embed(self, texts: Sequence[str]) -> list[list[float]]:
            return await model.embed(texts)

    settings = _settings(max_inflight_requests=1)
    app = create_app(settings, RuntimeWithoutWarmup())
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": "Bearer " + settings.internal_token.get_secret_value()}

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
    ):
        first = asyncio.create_task(
            client.post(
                "/internal/v1/embeddings",
                headers=headers,
                json=_payload(settings),
            )
        )
        await asyncio.wait_for(asyncio.to_thread(encode_started.wait), timeout=1)
        first.cancel()
        try:
            await asyncio.sleep(0.05)
            assert not first.done()
            overloaded = await client.post(
                "/internal/v1/embeddings",
                headers=headers,
                json=_payload(settings),
            )
        finally:
            release_encode.set()

        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(first, timeout=1)

    assert overloaded.status_code == 429


async def test_warmup_failure_prevents_application_startup() -> None:
    class FailingEmbedding(FakeEmbedding):
        async def warmup(self) -> None:
            raise RuntimeError("CUDA warmup failed")

    with pytest.raises(RuntimeError, match="CUDA warmup failed"):
        app = create_app(_settings(), FailingEmbedding())
        async with app.router.lifespan_context(app):
            raise AssertionError("lifespan should not start")


def test_run_uses_validated_bind_and_log_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    settings = _settings(host="127.0.0.1", port=8020, log_level="WARNING")
    embedding = FakeEmbedding()

    monkeypatch.setattr(main, "load_settings", lambda: settings)
    monkeypatch.setattr(main, "BgeM3EmbeddingModel", lambda *args, **kwargs: embedding)

    def fake_run(_app: object, **kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(main.uvicorn, "run", fake_run)

    main.run()

    assert captured == {"host": "127.0.0.1", "port": 8020, "log_level": "warning"}
