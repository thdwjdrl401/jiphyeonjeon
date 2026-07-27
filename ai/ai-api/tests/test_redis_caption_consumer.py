import asyncio
import json
import os
from collections import deque
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from redis.exceptions import ResponseError

from app.adapters.redis_caption_consumer import (
    CAPTION_CONSUMER_GROUP,
    CaptionConsumerState,
    RedisCaptionConsumer,
)
from app.captions import CaptionContextStore, parse_caption_entry

FIXTURES_DIR = Path(__file__).parents[2] / "realtime-agent" / "contracts" / "fixtures"
SESSION_ID = "11111111-1111-4111-8111-111111111111"
DEFAULT_TEST_REDIS_URL = "redis://127.0.0.1:6379/15"


class FakeRedis:
    def __init__(
        self,
        reads: list[list] | None = None,
        pending_entries: list[dict] | None = None,
        stream_entries: dict[str, tuple[str, dict[str, str]]] | None = None,
        ack_results: list[object] | None = None,
    ) -> None:
        self.reads = deque(reads or [])
        self.pending_entries = list(pending_entries or [])
        self.stream_entries = dict(stream_entries or {})
        self.group_calls: list[tuple] = []
        self.read_calls: list[dict[str, str]] = []
        self.pending_range_calls: list[str | None] = []
        self.ack_results = deque(ack_results or [])
        self.acked: list[str] = []
        self.closed = False

    async def ping(self):
        return True

    async def xgroup_create(self, name, groupname, id, *, mkstream):
        self.group_calls.append((name, groupname, id, mkstream))

    async def xreadgroup(self, groupname, consumername, streams, *, count, block=None):
        self.read_calls.append(dict(streams))
        return self.reads.popleft() if self.reads else []

    async def xack(self, name, groupname, *ids):
        result = self.ack_results.popleft() if self.ack_results else len(ids)
        if isinstance(result, BaseException):
            raise result
        if int(result) > 0:
            self.acked.extend(ids)
        return int(result)

    async def xinfo_groups(self, name):
        return [{"name": CAPTION_CONSUMER_GROUP, "lag": 3}]

    async def xpending(self, name, groupname):
        return {"pending": 2}

    async def xpending_range(self, name, groupname, min, max, count, consumername=None):
        self.pending_range_calls.append(consumername)
        acked = set(self.acked)
        return [entry for entry in self.pending_entries if entry["message_id"] not in acked][:count]

    async def xrange(self, name, min="-", max="+", count=None):
        entry = self.stream_entries.get(min)
        if entry is None or max != min:
            return []
        return [entry]

    async def aclose(self):
        self.closed = True


def _fixture(name: str) -> dict[str, str]:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def _consumer(fake: FakeRedis, handler, state=None) -> RedisCaptionConsumer:
    return RedisCaptionConsumer(
        "redis://unused",
        "ai-api-test",
        handler,
        state=state,
        client_factory=lambda: fake,
    )


def test_run_creates_group_recovers_owned_pending_before_new_entries() -> None:
    async def scenario() -> None:
        stop_event = asyncio.Event()
        observed: list[str] = []

        class OneCycleRedis(FakeRedis):
            async def xreadgroup(self, *args, **kwargs):
                assert observed == [" 외"]
                result = await super().xreadgroup(*args, **kwargs)
                stop_event.set()
                return result

        fields = _fixture("caption-delta.valid.json")
        fake = OneCycleRedis(
            pending_entries=[{"message_id": "1-0"}],
            stream_entries={"1-0": ("1-0", fields)},
        )
        state = CaptionConsumerState()
        consumer = RedisCaptionConsumer(
            "redis://unused",
            "ai-api-test",
            lambda entry: observed.append(parse_caption_entry(entry).text),
            state=state,
            block_ms=100,
            client_factory=lambda: fake,
        )

        await consumer.run(stop_event)

        assert fake.group_calls == [("ai:captions:live", CAPTION_CONSUMER_GROUP, "0-0", True)]
        assert fake.pending_range_calls == ["ai-api-test", "ai-api-test"]
        assert fake.read_calls == [{"ai:captions:live": ">"}]
        assert fake.acked == ["1-0"]
        assert state.lag == 3
        assert fake.closed is True

    asyncio.run(scenario())


def test_busy_group_is_the_only_ignored_group_error() -> None:
    class BusyRedis(FakeRedis):
        async def xgroup_create(self, *args, **kwargs):
            raise ResponseError("BUSYGROUP Consumer Group name already exists")

    class BrokenRedis(FakeRedis):
        async def xgroup_create(self, *args, **kwargs):
            raise ResponseError("NOPERM denied")

    busy = BusyRedis()
    asyncio.run(_consumer(busy, lambda fields: None)._ensure_group(busy))
    with pytest.raises(ResponseError, match="NOPERM"):
        broken = BrokenRedis()
        asyncio.run(_consumer(broken, lambda fields: None)._ensure_group(broken))


def test_poison_entry_is_dropped_and_acked_after_contract_validation() -> None:
    fake = FakeRedis()
    state = CaptionConsumerState()
    consumer = _consumer(fake, parse_caption_entry, state)

    asyncio.run(
        consumer._process_messages(
            fake,
            [["ai:captions:live", [[b"1-0", {"type": "bad"}]]]],
        )
    )

    assert fake.acked == ["1-0"]
    assert state.invalid_total == 1
    assert state.acked_total == 1


def test_transient_handler_failure_remains_pending() -> None:
    fake = FakeRedis()
    state = CaptionConsumerState()
    consumer = _consumer(
        fake,
        lambda entry: (_ for _ in ()).throw(RuntimeError("temporary")),
        state,
    )

    with pytest.raises(RuntimeError, match="temporary"):
        asyncio.run(
            consumer._process_messages(
                fake,
                [["ai:captions:live", [["1-0", _fixture("caption-delta.valid.json")]]]],
            )
        )

    assert fake.acked == []
    assert state.processing_error_total == 1


def test_ack_failure_replays_without_duplicating_context() -> None:
    fake = FakeRedis(ack_results=[ResponseError("connection lost"), 1])
    state = CaptionConsumerState()
    store = CaptionContextStore()
    consumer = _consumer(
        fake,
        lambda fields: store.ingest(parse_caption_entry(fields)),
        state,
    )
    messages = [["ai:captions:live", [["1-0", _fixture("caption-delta.valid.json")]]]]

    with pytest.raises(ResponseError, match="connection lost"):
        asyncio.run(consumer._process_messages(fake, messages))
    asyncio.run(consumer._process_messages(fake, messages))

    assert store.query(SESSION_ID, 41_000).text == " 외"
    assert store.metrics_snapshot()["duplicate_event_total"] == 1
    assert state.consumed_total == 2
    assert state.acked_total == 1


def test_real_redis_consumer_builds_context_without_skipping() -> None:
    async def scenario() -> None:
        redis_url = os.getenv("AI_API_TEST_REDIS_URL", DEFAULT_TEST_REDIS_URL)
        client = Redis.from_url(redis_url, decode_responses=True)
        stream = f"ai:test:rag-context:{uuid4()}"
        spring_group = f"spring-test-{uuid4()}"
        store = CaptionContextStore()
        state = CaptionConsumerState()
        consumer = RedisCaptionConsumer(
            redis_url,
            f"rag-test-{uuid4()}",
            lambda fields: store.ingest(parse_caption_entry(fields)),
            state=state,
            stream_key=stream,
            block_ms=100,
        )
        stop_event = asyncio.Event()
        task = asyncio.create_task(consumer.run(stop_event))
        try:
            await _wait_until(lambda: state.connected, task=task)
            await client.xgroup_create(stream, spring_group, "0-0", mkstream=True)
            entry_id = await client.xadd(stream, _fixture("caption-delta.valid.json"))
            await _wait_until(lambda: store.query(SESSION_ID, 41_000).available, task=task)
            await _wait_until(lambda: state.acked_total == 1, task=task)

            spring_messages = await client.xreadgroup(
                spring_group,
                "spring-test",
                {stream: ">"},
                count=1,
                block=1_000,
            )
            assert spring_messages[0][1][0][0] == entry_id
            assert store.query(SESSION_ID, 41_000).text == " 외"
            assert (await client.xpending(stream, CAPTION_CONSUMER_GROUP))["pending"] == 0
            assert (await client.xpending(stream, spring_group))["pending"] == 1
        finally:
            stop_event.set()
            try:
                await asyncio.wait_for(task, timeout=2)
            finally:
                try:
                    await client.delete(stream)
                finally:
                    await client.aclose()

    try:
        asyncio.run(scenario())
    except (OSError, TimeoutError):
        pytest.fail(
            "real Redis integration failed; start `docker compose up -d redis` "
            "or set AI_API_TEST_REDIS_URL"
        )


async def _wait_until(
    predicate: Callable[[], bool],
    *,
    task: asyncio.Task[None] | None = None,
    timeout_seconds: float = 3.0,
) -> None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while not predicate():
        if task is not None and task.done():
            if task.cancelled():
                raise AssertionError("consumer task was cancelled before the condition")
            exception = task.exception()
            if exception is not None:
                raise AssertionError("consumer task failed before the condition") from exception
            raise AssertionError("consumer task stopped before the condition")
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError("condition was not reached before timeout")
        await asyncio.sleep(0.01)
