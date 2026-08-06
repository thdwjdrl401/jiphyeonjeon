from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any, Protocol

from redis.asyncio import Redis

CONVERSATION_MEMORY_KEY_PREFIX = "ai:conversation:"


class RedisConversationMemoryClient(Protocol):
    async def get(self, name: str) -> Any: ...

    async def set(self, name: str, value: str, *, ex: int) -> Any: ...

    async def aclose(self) -> None: ...


class RedisConversationMemoryStore:
    """Maps (userId, sessionId, conversationId) to the latest GMS Responses API response id
    (ADR-0010), so a follow-up question in the same conversation can chain onto it via
    previous_response_id. TTL-based expiry doubles as the "conversation ended" boundary — no
    explicit end-of-conversation signal is required.
    """

    def __init__(
        self,
        redis_url: str,
        *,
        key_prefix: str = CONVERSATION_MEMORY_KEY_PREFIX,
        ttl_seconds: int = 1_800,
        socket_connect_timeout_seconds: float = 2.0,
        socket_timeout_seconds: float = 15.0,
        client_factory: Callable[[], RedisConversationMemoryClient] | None = None,
    ) -> None:
        if not redis_url:
            raise ValueError("Redis URL must not be empty")
        if not key_prefix:
            raise ValueError("conversation memory key prefix must not be empty")
        if ttl_seconds <= 0:
            raise ValueError("conversation memory ttl_seconds must be positive")
        if min(socket_connect_timeout_seconds, socket_timeout_seconds) <= 0:
            raise ValueError("conversation memory Redis timeouts must be positive")
        self._redis_url = redis_url
        self._key_prefix = key_prefix
        self._ttl_seconds = ttl_seconds
        self._socket_connect_timeout_seconds = socket_connect_timeout_seconds
        self._socket_timeout_seconds = socket_timeout_seconds
        self._owns_client = client_factory is None
        self._client = (client_factory or self._new_client)()

    def _new_client(self) -> RedisConversationMemoryClient:
        return Redis.from_url(
            self._redis_url,
            decode_responses=False,
            socket_connect_timeout=self._socket_connect_timeout_seconds,
            socket_timeout=self._socket_timeout_seconds,
        )

    async def get_previous_response_id(
        self, *, user_id: str, session_id: str, conversation_id: str
    ) -> str | None:
        raw = await self._client.get(self._key(user_id, session_id, conversation_id))
        if raw is None:
            return None
        return _decode_text(raw)

    async def save_response_id(
        self, *, user_id: str, session_id: str, conversation_id: str, response_id: str
    ) -> None:
        await self._client.set(
            self._key(user_id, session_id, conversation_id),
            response_id,
            ex=self._ttl_seconds,
        )

    async def delete_response_id(
        self, *, user_id: str, session_id: str, conversation_id: str
    ) -> None:
        """Drop a stored chain pointer. Used when the provider no longer recognizes the stored
        response id (GMS restart/key rotation) — keeping it would fail every question in the
        conversation until the TTL expires."""
        await self._client.delete(self._key(user_id, session_id, conversation_id))

    async def aclose(self) -> None:
        if not self._owns_client:
            return
        result = self._client.aclose()
        if inspect.isawaitable(result):
            await result

    def _key(self, user_id: str, session_id: str, conversation_id: str) -> str:
        return f"{self._key_prefix}{user_id}:{session_id}:{conversation_id}"


def _decode_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise ValueError("conversation memory response id must be text")
