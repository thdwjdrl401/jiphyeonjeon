import pytest
from pydantic import ValidationError

from app.config import Settings, load_settings
from app.database_urls import parse_migration_database_url


DATABASE_URL = "postgresql+asyncpg://ai:secret@localhost/liveclass"


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
    settings = Settings(instance_id="worker-1", database_url=DATABASE_URL)

    assert "secret" not in repr(settings)
    assert settings.database_url.get_secret_value() == DATABASE_URL


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
