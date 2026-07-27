import pytest
from pydantic import ValidationError

from app.config import Settings, load_settings
from app.database_urls import parse_migration_database_url


DATABASE_URL = "postgresql+asyncpg://ai:secret@localhost/liveclass"
CALLBACK_SECRET = "dev-ai-callback-secret"
BGE_TOKEN = "x" * 32


def test_requires_worker_instance_id() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url=DATABASE_URL)


def test_requires_database_url() -> None:
    with pytest.raises(ValidationError):
        Settings(instance_id="worker-1")


def test_rejects_empty_worker_instance_id() -> None:
    with pytest.raises(ValidationError):
        Settings(instance_id="", database_url=DATABASE_URL)


def test_rejects_invalid_management_port() -> None:
    with pytest.raises(ValidationError):
        Settings(instance_id="worker-1", database_url=DATABASE_URL, management_port=0)


@pytest.mark.parametrize(
    "database_url",
    [
        "not-a-url",
        "postgresql://ai:secret@localhost/liveclass",
        "postgresql+psycopg://ai:secret@localhost/liveclass",
        "sqlite+aiosqlite:///worker.db",
        "postgresql+asyncpg://ai:secret@localhost",
    ],
)
def test_rejects_non_asyncpg_database_url(database_url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(instance_id="worker-1", database_url=database_url)


def test_database_password_is_redacted_from_settings_repr() -> None:
    settings = Settings(
        instance_id="worker-1",
        database_url=DATABASE_URL,
        spring_hmac_secret=CALLBACK_SECRET,
        bge_internal_token=BGE_TOKEN,
    )

    assert DATABASE_URL not in repr(settings)
    assert CALLBACK_SECRET not in repr(settings)
    assert BGE_TOKEN not in repr(settings)
    assert settings.database_url.get_secret_value() == DATABASE_URL


def test_pptx_runtime_defaults_match_spring_and_bge_contracts() -> None:
    settings = Settings(instance_id="worker-1", database_url=DATABASE_URL)

    assert settings.tenant_id == "liveclass"
    assert settings.spring_internal_base_url == "http://127.0.0.1:8080"
    assert settings.bge_runtime_url == "http://127.0.0.1:8020"
    assert settings.embedding_model == "BAAI/bge-m3"
    assert settings.embedding_revision == "5617a9f61b028005a4858fdac845db406aefb181"
    assert settings.embedding_max_batch_size == 4
    assert settings.source_max_bytes == 50 * 1024 * 1024
    assert settings.chunk_max_chars == 1_200


def test_accepts_shared_spring_secret_from_documented_environment(monkeypatch) -> None:
    monkeypatch.setenv("AI_CALLBACK_SECRET", CALLBACK_SECRET)

    settings = Settings(instance_id="worker-1", database_url=DATABASE_URL)

    assert settings.spring_hmac_secret is not None
    assert settings.spring_hmac_secret.get_secret_value() == CALLBACK_SECRET


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenant_id", " liveclass"),
        ("spring_internal_base_url", "ftp://spring.internal"),
        ("spring_internal_base_url", "http://user:pass@spring.internal"),
        ("spring_internal_base_url", "http://spring.internal/api"),
        ("bge_runtime_url", "http://bge-runtime:invalid"),
        ("embedding_revision", "main"),
        ("embedding_max_batch_size", 8),
        ("spring_hmac_secret", " padded"),
        ("bge_internal_token", "short"),
    ],
)
def test_rejects_invalid_pptx_runtime_configuration(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        Settings(instance_id="worker-1", database_url=DATABASE_URL, **{field: value})


def test_migration_url_requires_an_explicit_psycopg_driver() -> None:
    migration_url = "postgresql+psycopg://ai:p%25ss@db.internal:5433/liveclass?sslmode=require"

    assert parse_migration_database_url(migration_url).database == "liveclass"
    with pytest.raises(ValueError, match="postgresql\\+psycopg"):
        parse_migration_database_url(DATABASE_URL)


def test_load_settings_fails_when_required_environment_is_missing(monkeypatch) -> None:
    monkeypatch.delenv("AI_WORKER_INSTANCE_ID", raising=False)
    monkeypatch.setenv("AI_WORKER_DATABASE_URL", DATABASE_URL)
    load_settings.cache_clear()

    with pytest.raises(ValidationError):
        load_settings()

    load_settings.cache_clear()
