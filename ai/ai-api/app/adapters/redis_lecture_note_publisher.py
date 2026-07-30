from __future__ import annotations

import inspect
import json
from collections.abc import Callable, Mapping
from typing import Any, Protocol, Self

from redis.asyncio import Redis

from app.lecture_notes import LectureNoteEvent
from app.lecture_notes.recovery import LectureNoteSessionCheckpoint

LECTURE_NOTE_STREAM_KEY = "ai:lecture-notes:mvp"
LECTURE_NOTE_STATE_KEY_PREFIX = "ai:lecture-notes:mvp:state:"
LECTURE_NOTE_ACTIVE_SESSIONS_KEY = "ai:lecture-notes:mvp:active-sessions"


class RedisLectureNotePipeline(Protocol):
    def set(self, name: str, value: str) -> Self: ...

    def sadd(self, name: str, *values: str) -> Self: ...

    def srem(self, name: str, *values: str) -> Self: ...

    def delete(self, *names: str) -> Self: ...

    def xadd(
        self,
        name: str,
        fields: Mapping[str, str],
        *,
        maxlen: int,
        approximate: bool,
    ) -> Self: ...

    async def execute(self) -> list[object]: ...


class RedisLectureNoteClient(Protocol):
    def pipeline(self, *, transaction: bool) -> RedisLectureNotePipeline: ...

    async def smembers(self, name: str) -> set[Any]: ...

    async def get(self, name: str) -> Any: ...

    async def srem(self, name: str, *values: str) -> int: ...

    async def aclose(self) -> None: ...


class RedisLectureNoteStore:
    """세션 checkpoint와 append event를 같은 Redis 경계에서 관리한다."""

    def __init__(
        self,
        redis_url: str,
        *,
        stream_key: str = LECTURE_NOTE_STREAM_KEY,
        stream_maxlen: int = 10_000,
        state_key_prefix: str = LECTURE_NOTE_STATE_KEY_PREFIX,
        active_sessions_key: str = LECTURE_NOTE_ACTIVE_SESSIONS_KEY,
        socket_connect_timeout_seconds: float = 2.0,
        socket_timeout_seconds: float = 15.0,
        client_factory: Callable[[], RedisLectureNoteClient] | None = None,
    ) -> None:
        if not redis_url:
            raise ValueError("Redis URL must not be empty")
        if not stream_key or not state_key_prefix or not active_sessions_key:
            raise ValueError("lecture note Redis keys must not be empty")
        if min(stream_maxlen, socket_connect_timeout_seconds, socket_timeout_seconds) <= 0:
            raise ValueError("lecture note Redis bounds must be positive")
        self._redis_url = redis_url
        self._stream_key = stream_key
        self._stream_maxlen = stream_maxlen
        self._state_key_prefix = state_key_prefix
        self._active_sessions_key = active_sessions_key
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

    async def save(self, checkpoint: LectureNoteSessionCheckpoint) -> None:
        pipeline = self._client.pipeline(transaction=True)
        pipeline.set(self._state_key(checkpoint.sessionId), checkpoint.model_dump_json())
        pipeline.sadd(self._active_sessions_key, checkpoint.sessionId)
        await pipeline.execute()

    async def commit(
        self,
        checkpoint: LectureNoteSessionCheckpoint,
        event: LectureNoteEvent,
    ) -> None:
        """결과 XADD와 outbox를 비운 checkpoint를 한 transaction으로 확정한다."""
        pipeline = self._client.pipeline(transaction=True)
        pipeline.set(self._state_key(checkpoint.sessionId), checkpoint.model_dump_json())
        pipeline.sadd(self._active_sessions_key, checkpoint.sessionId)
        pipeline.xadd(
            self._stream_key,
            _stream_fields(event.model_dump(mode="json")),
            maxlen=self._stream_maxlen,
            approximate=True,
        )
        await pipeline.execute()

    async def load_active(self) -> tuple[LectureNoteSessionCheckpoint, ...]:
        checkpoints: list[LectureNoteSessionCheckpoint] = []
        for raw_session_id in await self._client.smembers(self._active_sessions_key):
            session_id = _decode_text(raw_session_id)
            checkpoint = await self.load(session_id)
            if checkpoint is None:
                await self._client.srem(self._active_sessions_key, session_id)
                continue
            checkpoints.append(checkpoint)
        return tuple(checkpoints)

    async def load(self, session_id: str) -> LectureNoteSessionCheckpoint | None:
        raw_checkpoint = await self._client.get(self._state_key(session_id))
        if raw_checkpoint is None:
            return None
        return LectureNoteSessionCheckpoint.model_validate_json(
            _decode_text(raw_checkpoint)
        )

    async def deactivate(self, session_id: str) -> None:
        pipeline = self._client.pipeline(transaction=True)
        pipeline.srem(self._active_sessions_key, session_id)
        pipeline.delete(self._state_key(session_id))
        await pipeline.execute()

    async def aclose(self) -> None:
        if not self._owns_client:
            return
        result = self._client.aclose()
        if inspect.isawaitable(result):
            await result

    def _state_key(self, session_id: str) -> str:
        return f"{self._state_key_prefix}{session_id}"


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


def _decode_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise ValueError("Redis lecture note state must be text")
