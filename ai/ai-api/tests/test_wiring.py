import asyncio
import base64
import hashlib
import hmac
import json
import time

import pytest

from app.adapters import HmacInternalRequestAuthenticator
from app.config import Settings
from app.main import build_internal_authenticator
from app.wiring import (
    LECTURE_NOTE_CONSUMER_GROUP,
    build_answer_model,
    build_lecture_note_services,
    build_rag_context_services,
    build_rag_services,
)

DATABASE_URL = "postgresql+asyncpg://ai_runtime:secret@127.0.0.1:5432/liveclass"
BGE_TOKEN = "bge-runtime-token-that-is-at-least-32-characters"
GMS_KEY = "gms-api-key-for-tests"


def _settings() -> Settings:
    return Settings(
        database_url=DATABASE_URL,
        database_role="ai_app",
        bge_base_url="http://127.0.0.1:8020",
        bge_token=BGE_TOKEN,
        gms_api_key=GMS_KEY,
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


def test_answer_model_requires_gms_key() -> None:
    with pytest.raises(ValueError, match="AI_API_GMS_API_KEY"):
        build_answer_model(Settings())


def test_lecture_note_wiring_uses_independent_group_and_stable_identity() -> None:
    services = build_lecture_note_services(_settings())

    assert services.consumer.group_name == LECTURE_NOTE_CONSUMER_GROUP
    assert services.consumer.group_name == "ai-live-notes-mvp-v1"
    assert services.consumer.consumer_name == "ai-api-test-1:live-notes-mvp"
    assert services.consumer.stream_key == "ai:test:captions"
    assert services.model.metrics_snapshot()["max_concurrency"] == 4
    assert services.model.metrics_snapshot()["refinement_max_concurrency"] == 1

    asyncio.run(services.close())


def test_full_rag_wiring_builds_registry_and_closes_all_clients() -> None:
    services = build_rag_services(_settings())

    assert services.service is not None
    assert asyncio.run(services.registry.snapshot()) == {"active": 0, "completed": 0}

    answer_client = services.answer_model._client
    embedding_client = services.context.embedding._client
    asyncio.run(services.close())

    assert answer_client.is_closed
    assert embedding_client.is_closed


def test_internal_authenticator_is_none_without_secret() -> None:
    assert build_internal_authenticator(Settings()) is None


def test_internal_authenticator_is_built_when_secret_configured() -> None:
    authenticator = build_internal_authenticator(
        Settings(ai_internal_secret="shared-spring-ai-api-secret")
    )

    assert isinstance(authenticator, HmacInternalRequestAuthenticator)


def test_internal_authenticator_secret_is_usable_as_hmac_key() -> None:
    authenticator = build_internal_authenticator(
        Settings(ai_internal_secret="shared-spring-ai-api-secret")
    )

    body = json.dumps({"issuedAtMs": int(time.time() * 1000)}).encode("utf-8")
    expected = base64.b64encode(
        hmac.new(b"shared-spring-ai-api-secret", body, hashlib.sha256).digest()
    ).decode("ascii")

    asyncio.run(authenticator.authenticate(body, expected))
