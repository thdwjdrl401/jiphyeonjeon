import asyncio

import pytest

from app.adapters.redis_conversation_memory import RedisConversationMemoryStore


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.set_calls: list[tuple[str, str, int]] = []
        self.closed = False

    async def get(self, name):
        return self.values.get(name)

    async def set(self, name, value, *, ex):
        self.set_calls.append((name, value, ex))
        self.values[name] = value.encode("utf-8")

    async def aclose(self):
        self.closed = True


def _store(client: FakeRedis, **overrides) -> RedisConversationMemoryStore:
    kwargs = {"ttl_seconds": 1_800}
    kwargs.update(overrides)
    return RedisConversationMemoryStore(
        "redis://127.0.0.1:6379/0",
        client_factory=lambda: client,
        **kwargs,
    )


def test_rejects_invalid_construction_arguments() -> None:
    with pytest.raises(ValueError):
        RedisConversationMemoryStore("")
    with pytest.raises(ValueError):
        RedisConversationMemoryStore("redis://127.0.0.1:6379/0", key_prefix="")
    with pytest.raises(ValueError):
        RedisConversationMemoryStore("redis://127.0.0.1:6379/0", ttl_seconds=0)
    with pytest.raises(ValueError):
        RedisConversationMemoryStore(
            "redis://127.0.0.1:6379/0", socket_connect_timeout_seconds=0
        )


def test_lookup_before_any_save_returns_none() -> None:
    client = FakeRedis()
    store = _store(client)

    result = asyncio.run(
        store.get_previous_response_id(
            user_id="u1", session_id="s1", conversation_id="conv-abc"
        )
    )

    assert result is None


def test_save_then_lookup_round_trips_the_response_id() -> None:
    client = FakeRedis()
    store = _store(client, ttl_seconds=900)

    asyncio.run(
        store.save_response_id(
            user_id="u1", session_id="s1", conversation_id="conv-abc", response_id="resp_1"
        )
    )
    result = asyncio.run(
        store.get_previous_response_id(
            user_id="u1", session_id="s1", conversation_id="conv-abc"
        )
    )

    assert result == "resp_1"
    assert client.set_calls == [("ai:conversation:u1:s1:conv-abc", "resp_1", 900)]


def test_key_is_scoped_by_all_three_parts() -> None:
    """Different userId/sessionId/conversationId must never collide on the same key —
    this is the composite-key defense-in-depth described in ADR-0010."""
    client = FakeRedis()
    store = _store(client)

    asyncio.run(
        store.save_response_id(
            user_id="u1", session_id="s1", conversation_id="conv-abc", response_id="resp_1"
        )
    )

    other_user = asyncio.run(
        store.get_previous_response_id(
            user_id="u2", session_id="s1", conversation_id="conv-abc"
        )
    )
    other_session = asyncio.run(
        store.get_previous_response_id(
            user_id="u1", session_id="s2", conversation_id="conv-abc"
        )
    )
    other_conversation = asyncio.run(
        store.get_previous_response_id(
            user_id="u1", session_id="s1", conversation_id="conv-xyz"
        )
    )

    assert other_user is None
    assert other_session is None
    assert other_conversation is None


def test_custom_key_prefix_is_applied() -> None:
    client = FakeRedis()
    store = _store(client, key_prefix="custom:prefix:")

    asyncio.run(
        store.save_response_id(
            user_id="u1", session_id="s1", conversation_id="conv-abc", response_id="resp_1"
        )
    )

    assert "custom:prefix:u1:s1:conv-abc" in client.values


def test_aclose_only_closes_owned_client() -> None:
    client = FakeRedis()
    store = _store(client)

    asyncio.run(store.aclose())

    assert client.closed is False  # client_factory-provided clients are not "owned"
