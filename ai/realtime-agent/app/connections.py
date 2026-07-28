from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from urllib.parse import urlparse

from livekit import api
from redis.asyncio import Redis


@dataclass(frozen=True, slots=True)
class LiveKitConnectionSettings:
    url: str
    api_key: str = field(repr=False)
    api_secret: str = field(repr=False)

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        url: str | None = None,
    ) -> LiveKitConnectionSettings:
        values = os.environ if environ is None else environ
        return cls(
            url=(values.get("LIVEKIT_URL", "") if url is None else url).strip(),
            api_key=values.get("LIVEKIT_API_KEY", "").strip(),
            api_secret=values.get("LIVEKIT_API_SECRET", "").strip(),
        )

    def validate(self) -> None:
        missing = [
            name
            for name, value in (
                ("LIVEKIT_URL", self.url),
                ("LIVEKIT_API_KEY", self.api_key),
                ("LIVEKIT_API_SECRET", self.api_secret),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"missing required LiveKit settings: {', '.join(missing)}")
        parsed = urlparse(self.url)
        if parsed.scheme not in {"ws", "wss"} or not parsed.netloc:
            raise RuntimeError("LIVEKIT_URL must use ws or wss")


@dataclass(frozen=True, slots=True)
class RedisConnectionSettings:
    url: str = field(repr=False)
    username: str = field(default="", repr=False)
    password: str = field(default="", repr=False)

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        url: str | None = None,
        username: str | None = None,
        password: str | None = None,
    ) -> RedisConnectionSettings:
        values = os.environ if environ is None else environ
        return cls(
            url=(values.get("REDIS_URL", "") if url is None else url).strip(),
            username=values.get("REDIS_USERNAME", "") if username is None else username,
            password=values.get("REDIS_PASSWORD", "") if password is None else password,
        )

    def validate(self) -> None:
        parsed = urlparse(self.url)
        if parsed.scheme not in {"redis", "rediss"} or not parsed.netloc:
            raise RuntimeError("REDIS_URL must use redis or rediss")


def create_livekit_api_client(settings: LiveKitConnectionSettings) -> api.LiveKitAPI:
    settings.validate()
    return api.LiveKitAPI(
        url=settings.url,
        api_key=settings.api_key,
        api_secret=settings.api_secret,
    )


def create_redis_client(
    settings: RedisConnectionSettings,
    *,
    strict_utf8: bool = False,
) -> Redis:
    settings.validate()
    options: dict[str, object] = {
        "username": settings.username or None,
        "password": settings.password or None,
        "decode_responses": True,
    }
    if strict_utf8:
        options["encoding_errors"] = "strict"
    return Redis.from_url(settings.url, **options)
