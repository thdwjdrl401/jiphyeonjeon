from __future__ import annotations

import inspect
import json
from collections.abc import Callable, Mapping
from typing import Any, Protocol

from redis.asyncio import Redis

from app.lecture_notes import LectureNoteSnapshot

LECTURE_NOTE_SNAPSHOT_PREFIX = "ai:lecture-notes:mvp:snapshot"
LECTURE_NOTE_STREAM_KEY = "ai:lecture-notes:mvp"


class RedisLectureNoteClient(Protocol):
    async def set(self, name: str, value: str, *, ex: int) -> object: ...

    async def xadd(
        self,
        name: str,
        fields: Mapping[str, str],
        *,
        maxlen: int,
        approximate: bool,
    ) -> object: ...

    async def aclose(self) -> None: ...


class RedisLectureNoteSnapshotStore:
    """MVP snapshot JSON과 관찰용 Stream event를 application Redis에 기록한다."""

    def __init__(
        self,
        redis_url: str,
        *,
        snapshot_prefix: str = LECTURE_NOTE_SNAPSHOT_PREFIX,
        stream_key: str = LECTURE_NOTE_STREAM_KEY,
        snapshot_ttl_seconds: int = 86_400,
        stream_maxlen: int = 10_000,
        socket_connect_timeout_seconds: float = 2.0,
        socket_timeout_seconds: float = 15.0,
        client_factory: Callable[[], RedisLectureNoteClient] | None = None,
    ) -> None:
        if not redis_url:
            raise ValueError("Redis URL must not be empty")
        if not snapshot_prefix or not stream_key:
            raise ValueError("lecture note Redis keys must not be empty")
        if (
            min(
                snapshot_ttl_seconds,
                stream_maxlen,
                socket_connect_timeout_seconds,
                socket_timeout_seconds,
            )
            <= 0
        ):
            raise ValueError("lecture note Redis bounds must be positive")
        self._redis_url = redis_url
        self._snapshot_prefix = snapshot_prefix
        self._stream_key = stream_key
        self._snapshot_ttl_seconds = snapshot_ttl_seconds
        self._stream_maxlen = stream_maxlen
        self._socket_connect_timeout_seconds = socket_connect_timeout_seconds
        self._socket_timeout_seconds = socket_timeout_seconds
        self._owns_client = client_factory is None
        self._client = (client_factory or self._new_client)()

    def _new_client(self) -> RedisLectureNoteClient:
        return Redis.from_url(
            self._redis_url,
            decode_responses=False,
            socket_connect_timeout=self._socket_connect_timeout_seconds,
            socket_timeout=self._socket_timeout_seconds,
        )

    async def save(self, snapshot: LectureNoteSnapshot) -> None:
        payload = snapshot.model_dump(mode="json")
        snapshot_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        await self._client.set(
            f"{self._snapshot_prefix}:{snapshot.sessionId}",
            snapshot_json,
            ex=self._snapshot_ttl_seconds,
        )
        await self._client.xadd(
            self._stream_key,
            _stream_fields(payload),
            maxlen=self._stream_maxlen,
            approximate=True,
        )

    async def aclose(self) -> None:
        if not self._owns_client:
            return
        result = self._client.aclose()
        if inspect.isawaitable(result):
            await result


def _stream_fields(payload: dict[str, Any]) -> dict[str, str]:
    fields: dict[str, str] = {}
    for key, value in payload.items():
        if isinstance(value, (dict, list)):
            fields[key] = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        elif value is None:
            fields[key] = ""
        else:
            fields[key] = str(value)
    return fields
