import asyncio
import json
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.adapters.redis_lecture_note_publisher import RedisLectureNoteEventPublisher
from app.lecture_notes import LectureNoteChunkAppended, TopicAction

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
DEFAULT_TEST_REDIS_URL = "redis://127.0.0.1:6379/15"


class FakeRedis:
    def __init__(self) -> None:
        self.xadd_calls = []

    async def xadd(self, name, fields, *, maxlen, approximate):
        self.xadd_calls.append((name, fields, maxlen, approximate))
        return "1-0"

    async def aclose(self) -> None:
        return None


def _event() -> LectureNoteChunkAppended:
    return LectureNoteChunkAppended(
        eventId="evt-note-1",
        sessionId=SESSION_ID,
        lessonId=LESSON_ID,
        sttSessionId="attempt-1",
        chunkSequence="4",
        latestSttSequence="128",
        topicAction=TopicAction.CONTINUE,
        topicId="topic-1",
        topicTitle="Refresh Token의 역할",
        keyPoints=("Access Token 재발급에 사용한다.",),
        markdownFragment="- Access Token 재발급에 사용한다.",
        occurredAt=datetime(2026, 7, 29, 12, 0, 30, tzinfo=UTC),
    )


def test_publisher_writes_bounded_append_event() -> None:
    async def scenario() -> None:
        redis = FakeRedis()
        publisher = RedisLectureNoteEventPublisher(
            "redis://unused",
            client_factory=lambda: redis,
        )

        await publisher.publish(_event())

        stream, fields, maxlen, approximate = redis.xadd_calls[0]
        assert stream == "ai:lecture-notes:mvp"
        assert fields["type"] == "lecture.note.chunk.appended"
        assert fields["chunkSequence"] == "4"
        assert json.loads(fields["keyPoints"]) == ["Access Token 재발급에 사용한다."]
        assert maxlen == 10_000
        assert approximate is True

    asyncio.run(scenario())


def test_real_redis_publisher_persists_stream_fields() -> None:
    async def scenario() -> None:
        redis_url = os.getenv("AI_API_TEST_REDIS_URL", DEFAULT_TEST_REDIS_URL)
        stream = f"ai:test:lecture-note:stream:{uuid4()}"
        client = Redis.from_url(redis_url, decode_responses=True)
        publisher = RedisLectureNoteEventPublisher(
            redis_url,
            stream_key=stream,
            stream_maxlen=100,
        )
        try:
            await publisher.publish(_event())

            entries = await client.xrange(stream)

            assert len(entries) == 1
            assert entries[0][1]["chunkSequence"] == "4"
            assert json.loads(entries[0][1]["keyPoints"])[0].startswith("Access Token")
        finally:
            try:
                await publisher.aclose()
            finally:
                try:
                    await client.delete(stream)
                finally:
                    await client.aclose()

    try:
        asyncio.run(scenario())
    except (OSError, TimeoutError, RedisError):
        pytest.fail(
            "real Redis integration failed; start `docker compose up -d redis` "
            "or set AI_API_TEST_REDIS_URL"
        )
