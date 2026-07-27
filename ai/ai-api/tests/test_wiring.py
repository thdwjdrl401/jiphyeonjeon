import asyncio

import pytest

from app.config import Settings
from app.wiring import build_rag_context_services

DATABASE_URL = "postgresql+asyncpg://ai_runtime:secret@127.0.0.1:5432/liveclass"
BGE_TOKEN = "bge-runtime-token-that-is-at-least-32-characters"


def _settings() -> Settings:
    return Settings(
        database_url=DATABASE_URL,
        database_role="ai_app",
        bge_base_url="http://127.0.0.1:8020",
        bge_token=BGE_TOKEN,
        caption_stream_key="ai:test:captions",
        instance_id="ai-api-test-1",
    )


@pytest.mark.parametrize(
    "settings",
    [
        Settings(bge_base_url="http://127.0.0.1:8020", bge_token=BGE_TOKEN),
        Settings(database_url=DATABASE_URL),
    ],
)
def test_context_wiring_requires_database_and_bge_settings(settings: Settings) -> None:
    with pytest.raises(ValueError):
        build_rag_context_services(settings)


def test_context_wiring_builds_closeable_components_without_connecting() -> None:
    services = build_rag_context_services(_settings())

    assert services.consumer.state is services.consumer_state
    assert services.store.metrics_snapshot()["tracked_sessions"] == 0
    assert services.retriever is not None

    asyncio.run(services.close())
