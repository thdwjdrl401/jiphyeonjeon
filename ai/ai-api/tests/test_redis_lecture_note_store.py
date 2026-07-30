import asyncio
import json
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.adapters.redis_lecture_note_store import RedisLectureNoteSnapshotStore
from app.lecture_notes import (
    LectureNoteSnapshot,
    LectureNoteSnapshotTopic,
    LectureNoteStatus,
)

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
DEFAULT_TEST_REDIS_URL = "redis://127.0.0.1:6379/15"


class FakeRedis:
    def __init__(self) -> None:
        self.set_calls = []
        self.xadd_calls = []

    async def set(self, name, value, *, ex):
        self.set_calls.append((name, value, ex))
        return True

    async def xadd(self, name, fields, *, maxlen, approximate):
        self.xadd_calls.append((name, fields, maxlen, approximate))
        return "1-0"

    async def aclose(self) -> None:
        return None


def _snapshot() -> LectureNoteSnapshot:
    return LectureNoteSnapshot(
        eventId="evt-note-1",
        sessionId=SESSION_ID,
        lessonId=LESSON_ID,
        sttSessionId="attempt-1",
        noteVersion="4",
        coveredThroughSequence="128",
        status=LectureNoteStatus.PROCESSING,
        topics=(
            LectureNoteSnapshotTopic(
                topicId="topic-1",
                title="Refresh Token의 역할",
                keyPoints=("Access Token 재발급에 사용한다.",),
            ),
        ),
        markdown="## Refresh Token의 역할\n\n- Access Token 재발급에 사용한다.",
        occurredAt=datetime(2026, 7, 29, 12, 0, 30, tzinfo=UTC),
    )


def test_store_writes_snapshot_ttl_and_bounded_stream_event() -> None:
    async def scenario() -> None:
        redis = FakeRedis()
        store = RedisLectureNoteSnapshotStore(
            "redis://unused",
            client_factory=lambda: redis,
        )

        await store.save(_snapshot())

        key, raw_snapshot, ttl = redis.set_calls[0]
        assert key == f"ai:lecture-notes:mvp:snapshot:{SESSION_ID}"
        assert ttl == 86_400
        assert json.loads(raw_snapshot)["topics"][0]["title"] == "Refresh Token의 역할"
        stream, fields, maxlen, approximate = redis.xadd_calls[0]
        assert stream == "ai:lecture-notes:mvp"
        assert fields["noteVersion"] == "4"
        assert json.loads(fields["topics"])[0]["topicId"] == "topic-1"
        assert maxlen == 10_000
        assert approximate is True

    asyncio.run(scenario())


def test_real_redis_store_persists_snapshot_ttl_and_stream_fields() -> None:
    async def scenario() -> None:
        redis_url = os.getenv("AI_API_TEST_REDIS_URL", DEFAULT_TEST_REDIS_URL)
        prefix = f"ai:test:lecture-note:snapshot:{uuid4()}"
        stream = f"ai:test:lecture-note:stream:{uuid4()}"
        snapshot_key = f"{prefix}:{SESSION_ID}"
        client = Redis.from_url(redis_url, decode_responses=True)
        store = RedisLectureNoteSnapshotStore(
            redis_url,
            snapshot_prefix=prefix,
            stream_key=stream,
            snapshot_ttl_seconds=120,
            stream_maxlen=100,
        )
        try:
            await store.save(_snapshot())

            raw_snapshot = await client.get(snapshot_key)
            ttl = await client.ttl(snapshot_key)
            entries = await client.xrange(stream)

            assert raw_snapshot is not None
            assert json.loads(raw_snapshot)["topics"][0]["title"] == "Refresh Token의 역할"
            assert 0 < ttl <= 120
            assert len(entries) == 1
            assert entries[0][1]["noteVersion"] == "4"
            assert json.loads(entries[0][1]["topics"])[0]["topicId"] == "topic-1"
        finally:
            try:
                await store.aclose()
            finally:
                try:
                    await client.delete(snapshot_key, stream)
                finally:
                    await client.aclose()

    try:
        asyncio.run(scenario())
    except (OSError, TimeoutError, RedisError):
        pytest.fail(
            "real Redis integration failed; start `docker compose up -d redis` "
            "or set AI_API_TEST_REDIS_URL"
        )
