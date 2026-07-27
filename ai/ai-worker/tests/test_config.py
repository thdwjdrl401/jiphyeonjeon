import pytest
from pydantic import ValidationError

from app.config import Settings, load_settings


def test_requires_worker_instance_id() -> None:
    with pytest.raises(ValidationError):
        Settings()


def test_rejects_empty_worker_instance_id() -> None:
    with pytest.raises(ValidationError):
        Settings(instance_id="")


def test_rejects_invalid_management_port() -> None:
    with pytest.raises(ValidationError):
        Settings(instance_id="worker-1", management_port=0)


def test_load_settings_fails_when_required_environment_is_missing(monkeypatch) -> None:
    monkeypatch.delenv("AI_WORKER_INSTANCE_ID", raising=False)
    load_settings.cache_clear()

    with pytest.raises(ValidationError):
        load_settings()

    load_settings.cache_clear()
