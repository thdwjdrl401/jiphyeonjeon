import pytest
from pydantic import ValidationError

from app.config import Settings, load_settings


def test_uses_loopback_defaults() -> None:
    settings = Settings()

    assert settings.host == "127.0.0.1"
    assert settings.port == 8010
    assert settings.redis_url == "redis://127.0.0.1:6379/0"
    assert settings.database_url is None
    assert settings.bge_base_url is None
    assert settings.gms_api_key is None
    assert settings.lecture_note_model == "gpt-5-mini"
    assert settings.lecture_note_reasoning_effort == "minimal"
    assert settings.lecture_note_gms_max_concurrency == 4
    assert settings.lecture_note_gms_refinement_max_concurrency == 1
    assert settings.lecture_note_gms_max_attempts == 3
    assert settings.rag_request_max_active == 256


def test_rejects_invalid_port() -> None:
    with pytest.raises(ValidationError):
        Settings(port=0)


def test_load_settings_reads_prefixed_environment(monkeypatch) -> None:
    monkeypatch.setenv("AI_API_PORT", "8110")
    load_settings.cache_clear()
    try:
        assert load_settings().port == 8110
    finally:
        load_settings.cache_clear()


@pytest.mark.parametrize(
    "values",
    [
        {"redis_url": "http://localhost:6379"},
        {"redis_url": "redis://localhost:99999"},
        {"caption_poll_block_ms": 1_000, "redis_socket_timeout_seconds": 1.0},
        {"redis_reconnect_min_seconds": 2.0, "redis_reconnect_max_seconds": 1.0},
        {"database_url": "postgresql+psycopg://localhost/liveclass"},
        {"database_role": "AI-APP"},
        {"bge_base_url": "http://127.0.0.1:8020"},
        {"bge_token": "x" * 32},
        {"bge_base_url": "http://user:secret@127.0.0.1:8020", "bge_token": "x" * 32},
        {"bge_base_url": "http://127.0.0.1:8020/../secret", "bge_token": "x" * 32},
        {"gms_api_key": " padded-key "},
        {"ai_internal_secret": " padded-secret "},
        {"gms_model": " gpt-4.1"},
        {"lecture_note_model": " gpt-4.1"},
        {"lecture_note_min_window_ms": 30_000, "lecture_note_target_window_ms": 20_000},
        {"lecture_note_min_chars": 500, "lecture_note_max_chars": 400},
        {
            "lecture_note_gms_max_concurrency": 1,
            "lecture_note_gms_refinement_max_concurrency": 2,
        },
        {
            "lecture_note_gms_retry_base_seconds": 2,
            "lecture_note_gms_retry_max_seconds": 1,
        },
        {"rag_retrieval_timeout_seconds": 8.0},
        {"rag_model_timeout_seconds": 55.0},
        {"caption_shutdown_timeout_seconds": 1.0},
    ],
)
def test_rejects_invalid_context_runtime_settings(values: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Settings(**values)


def test_accepts_complete_context_runtime_settings() -> None:
    settings = Settings(
        database_url="postgresql+asyncpg://ai_runtime:secret@127.0.0.1:5432/liveclass",
        bge_base_url="http://127.0.0.1:8020",
        bge_token="bge-runtime-token-that-is-at-least-32-characters",
    )

    assert settings.database_role == "ai_app"
    assert settings.bge_token is not None
    assert settings.bge_token.get_secret_value().startswith("bge-runtime")


def test_accepts_bge_base_url_with_reverse_proxy_path_prefix() -> None:
    settings = Settings(
        bge_base_url="https://jiphyeonjeon.thdwjdrl.com:7443/internal/bge",
        bge_token="bge-runtime-token-that-is-at-least-32-characters",
    )

    assert settings.bge_base_url == "https://jiphyeonjeon.thdwjdrl.com:7443/internal/bge"


@pytest.mark.parametrize("blank", ["", " ", "\t"])
def test_blank_gms_key_is_unconfigured(blank: str) -> None:
    assert Settings(gms_api_key=blank).gms_api_key is None


@pytest.mark.parametrize("blank", ["", " ", "\t"])
def test_blank_lecture_note_model_uses_shared_gms_model(blank: str) -> None:
    assert Settings(lecture_note_model=blank).lecture_note_model is None


def test_gms_secret_is_loaded_without_repr_leak(monkeypatch) -> None:
    secret = "private-gms-api-key"
    monkeypatch.setenv("AI_API_GMS_API_KEY", secret)
    load_settings.cache_clear()
    try:
        settings = load_settings()
        assert settings.gms_api_key is not None
        assert settings.gms_api_key.get_secret_value() == secret
        assert secret not in repr(settings)
    finally:
        load_settings.cache_clear()


@pytest.mark.parametrize("blank", ["", " ", "\t"])
def test_blank_ai_internal_secret_is_unconfigured(blank: str) -> None:
    assert Settings(ai_internal_secret=blank).ai_internal_secret is None


def test_ai_internal_secret_is_loaded_from_unprefixed_env_var(monkeypatch) -> None:
    secret = "shared-spring-ai-api-secret"
    monkeypatch.setenv("AI_INTERNAL_SECRET", secret)
    load_settings.cache_clear()
    try:
        settings = load_settings()
        assert settings.ai_internal_secret is not None
        assert settings.ai_internal_secret.get_secret_value() == secret
        assert secret not in repr(settings)
    finally:
        load_settings.cache_clear()


def test_ai_internal_secret_env_var_rejects_surrounding_whitespace(monkeypatch) -> None:
    monkeypatch.setenv("AI_INTERNAL_SECRET", " padded-secret ")
    load_settings.cache_clear()
    try:
        with pytest.raises(ValidationError):
            load_settings()
    finally:
        load_settings.cache_clear()
