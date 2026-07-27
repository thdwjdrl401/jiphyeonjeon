import pytest
from pydantic import ValidationError

from app.config import Settings, load_settings


def test_uses_loopback_defaults() -> None:
    settings = Settings()

    assert settings.host == "127.0.0.1"
    assert settings.port == 8010


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
