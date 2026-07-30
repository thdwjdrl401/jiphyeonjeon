from __future__ import annotations

import inspect
import json
from collections.abc import Callable, Mapping
from typing import Any, Protocol

from redis.asyncio import Redis

from app.lecture_notes import LectureNoteEvent

LECTURE_NOTE_STREAM_KEY = "ai:lecture-notes:mvp"


class RedisLectureNoteClient(Protocol):
    async def xadd(
        self,
        name: str,
        fields: Mapping[str, str],
        *,
        maxlen: int,
        approximate: bool,
    ) -> object: ...

    async def aclose(self) -> None: ...


class RedisLectureNoteEventPublisher:
    """추가 노트 조각과 수집 완료 event를 bounded Redis Stream에 발행한다."""

    def __init__(
        self,
        redis_url: str,
        *,
        stream_key: str = LECTURE_NOTE_STREAM_KEY,
        stream_maxlen: int = 10_000,
        socket_connect_timeout_seconds: float = 2.0,
        socket_timeout_seconds: float = 15.0,
        client_factory: Callable[[], RedisLectureNoteClient] | None = None,
    ) -> None:
        if not redis_url:
            raise ValueError("Redis URL must not be empty")
        if not stream_key:
            raise ValueError("lecture note Redis Stream key must not be empty")
        if min(stream_maxlen, socket_connect_timeout_seconds, socket_timeout_seconds) <= 0:
            raise ValueError("lecture note Redis bounds must be positive")
        self._redis_url = redis_url
        self._stream_key = stream_key
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

    async def publish(self, event: LectureNoteEvent) -> None:
        payload = event.model_dump(mode="json")
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
