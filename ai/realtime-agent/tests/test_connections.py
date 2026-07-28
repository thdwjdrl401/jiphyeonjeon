from __future__ import annotations

from app import connections
from app.connections import (
    LiveKitConnectionSettings,
    RedisConnectionSettings,
    create_livekit_api_client,
    create_redis_client,
)


def test_livekit_factory_uses_validated_redacted_connection(monkeypatch) -> None:
    captured: dict[str, object] = {}
    client = object()

    def build_client(*, url: str, api_key: str, api_secret: str) -> object:
        captured.update(url=url, api_key=api_key, api_secret=api_secret)
        return client

    monkeypatch.setattr(connections.api, "LiveKitAPI", build_client)
    settings = LiveKitConnectionSettings.from_env(
        {
            "LIVEKIT_URL": "wss://livekit.example",
            "LIVEKIT_API_KEY": "private-key",
            "LIVEKIT_API_SECRET": "private-secret",
        }
    )

    assert create_livekit_api_client(settings) is client
    assert captured == {
        "url": "wss://livekit.example",
        "api_key": "private-key",
        "api_secret": "private-secret",
    }
    assert "private-key" not in repr(settings)
    assert "private-secret" not in repr(settings)


def test_redis_factory_supports_default_user_and_strict_utf8(monkeypatch) -> None:
    captured: dict[str, object] = {}
    client = object()

    def from_url(url: str, **options: object) -> object:
        captured.update(url=url, **options)
        return client

    monkeypatch.setattr(connections.Redis, "from_url", staticmethod(from_url))
    settings = RedisConnectionSettings.from_env(
        {
            "REDIS_URL": "redis://localhost:4000/0",
            "REDIS_USERNAME": "",
            "REDIS_PASSWORD": "private-password",
        }
    )

    assert create_redis_client(settings, strict_utf8=True) is client
    assert captured == {
        "url": "redis://localhost:4000/0",
        "username": None,
        "password": "private-password",
        "decode_responses": True,
        "encoding_errors": "strict",
    }
    assert "private-password" not in repr(settings)
