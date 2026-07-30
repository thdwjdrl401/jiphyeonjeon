import asyncio
import json
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.adapters.redis_lecture_note_publisher import RedisLectureNoteStore
from app.lecture_notes import (
    LectureNote,
    LectureNoteChunkAppended,
    LectureNoteRefinedSnapshot,
    LectureNoteRefinedTopic,
    TopicAction,
)
from app.lecture_notes.recovery import (
    AttemptBufferCheckpoint,
    LectureNoteSessionCheckpoint,
    WindowAccumulatorCheckpoint,
)

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
DEFAULT_TEST_REDIS_URL = "redis://127.0.0.1:6379/15"


class FakePipeline:
    def __init__(self, redis) -> None:
        self.redis = redis
        self.operations = []

    def set(self, name, value):
        self.operations.append(("set", name, value))
        return self

    def sadd(self, name, *values):
        self.operations.append(("sadd", name, values))
        return self

    def srem(self, name, *values):
        self.operations.append(("srem", name, values))
        return self

    def delete(self, *names):
        self.operations.append(("delete", names))
        return self

    def xadd(self, name, fields, *, maxlen, approximate):
        self.operations.append(("xadd", name, fields, maxlen, approximate))
        return self

    async def execute(self):
        self.redis.transactions.append(tuple(self.operations))
        for operation in self.operations:
            kind = operation[0]
            if kind == "set":
                self.redis.values[operation[1]] = operation[2]
            elif kind == "sadd":
                self.redis.sets.setdefault(operation[1], set()).update(operation[2])
            elif kind == "srem":
                self.redis.sets.setdefault(operation[1], set()).difference_update(operation[2])
            elif kind == "delete":
                for name in operation[1]:
                    self.redis.values.pop(name, None)
            else:
                self.redis.xadd_calls.append(operation[1:])
        return [True] * len(self.operations)


class FakeRedis:
    def __init__(self) -> None:
        self.values = {}
        self.sets = {}
        self.transactions = []
        self.xadd_calls = []

    def pipeline(self, *, transaction):
        assert transaction is True
        return FakePipeline(self)

    async def smembers(self, name):
        return self.sets.get(name, set())

    async def get(self, name):
        return self.values.get(name)

    async def srem(self, name, *values):
        before = len(self.sets.get(name, set()))
        self.sets.setdefault(name, set()).difference_update(values)
        return before - len(self.sets[name])

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


def _checkpoint(*, outbox=None) -> LectureNoteSessionCheckpoint:
    return LectureNoteSessionCheckpoint(
        sessionId=SESSION_ID,
        lessonId=LESSON_ID,
        accumulator=WindowAccumulatorCheckpoint(
            sessionId=SESSION_ID,
            lessonId=LESSON_ID,
            current=AttemptBufferCheckpoint(sttSessionId="attempt-1", lastSequence=128),
        ),
        note=LectureNote(chunk_sequence=4),
        outbox=outbox,
        updatedAt=datetime.now(UTC),
    )


def _refined_event() -> LectureNoteRefinedSnapshot:
    return LectureNoteRefinedSnapshot(
        eventId="evt-refined-1",
        sessionId=SESSION_ID,
        lessonId=LESSON_ID,
        sttSessionId="attempt-1",
        sourceLastChunkSequence="4",
        topics=(
            LectureNoteRefinedTopic(
                topicId="refined-topic-1",
                topicTitle="정제 주제",
                keyPoints=("정제 요점이다.",),
            ),
        ),
        markdownSnapshot="## 정제 주제\n\n- 정제 요점이다.",
        occurredAt=datetime.now(UTC),
    )


def test_store_saves_and_restores_active_checkpoint() -> None:
    async def scenario() -> None:
        redis = FakeRedis()
        store = RedisLectureNoteStore("redis://unused", client_factory=lambda: redis)

        await store.save(_checkpoint())
        restored = await store.load_active()

        assert len(redis.transactions) == 1
        assert restored[0].sessionId == SESSION_ID
        assert restored[0].accumulator.current.lastSequence == 128

    asyncio.run(scenario())


def test_store_commits_checkpoint_and_append_event_in_one_transaction() -> None:
    async def scenario() -> None:
        redis = FakeRedis()
        store = RedisLectureNoteStore("redis://unused", client_factory=lambda: redis)

        await store.commit(_checkpoint(outbox=None), _event())

        operations = redis.transactions[0]
        assert [operation[0] for operation in operations] == ["set", "sadd", "xadd"]
        stream, fields, maxlen, approximate = redis.xadd_calls[0]
        assert stream == "ai:lecture-notes:mvp"
        assert fields["chunkSequence"] == "4"
        assert json.loads(fields["keyPoints"]) == ["Access Token 재발급에 사용한다."]
        assert maxlen == 10_000
        assert approximate is True

    asyncio.run(scenario())


def test_store_serializes_refined_topics_as_compact_json() -> None:
    async def scenario() -> None:
        redis = FakeRedis()
        store = RedisLectureNoteStore("redis://unused", client_factory=lambda: redis)

        await store.commit(_checkpoint(), _refined_event())

        _, fields, _, _ = redis.xadd_calls[0]
        assert set(fields) == {
            "contractVersion",
            "type",
            "eventId",
            "sessionId",
            "lessonId",
            "sttSessionId",
            "occurredAt",
            "sourceLastChunkSequence",
            "topics",
            "markdownSnapshot",
        }
        assert fields["type"] == "lecture.note.refined.snapshot"
        assert fields["sourceLastChunkSequence"] == "4"
        assert fields["topics"] == json.dumps(
            json.loads(fields["topics"]),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        assert json.loads(fields["topics"]) == [
            {
                "topicId": "refined-topic-1",
                "topicTitle": "정제 주제",
                "keyPoints": ["정제 요점이다."],
            }
        ]
        assert fields["markdownSnapshot"] == "## 정제 주제\n\n- 정제 요점이다."

    asyncio.run(scenario())


def test_real_redis_store_atomically_persists_checkpoint_and_event() -> None:
    async def scenario() -> None:
        redis_url = os.getenv("AI_API_TEST_REDIS_URL", DEFAULT_TEST_REDIS_URL)
        suffix = uuid4()
        stream = f"ai:test:lecture-note:stream:{suffix}"
        state_prefix = f"ai:test:lecture-note:state:{suffix}:"
        active_key = f"ai:test:lecture-note:active:{suffix}"
        state_key = f"{state_prefix}{SESSION_ID}"
        client = Redis.from_url(redis_url, decode_responses=True)
        store = RedisLectureNoteStore(
            redis_url,
            stream_key=stream,
            state_key_prefix=state_prefix,
            active_sessions_key=active_key,
            stream_maxlen=100,
        )
        try:
            await store.commit(_checkpoint(), _event())

            entries = await client.xrange(stream)
            restored = await store.load_active()

            assert len(entries) == 1
            assert entries[0][1]["chunkSequence"] == "4"
            assert restored[0].note.chunk_sequence == 4
        finally:
            try:
                await store.aclose()
            finally:
                try:
                    await client.delete(stream, state_key, active_key)
                finally:
                    await client.aclose()

    try:
        asyncio.run(scenario())
    except (OSError, TimeoutError, RedisError):
        pytest.fail(
            "real Redis integration failed; start `docker compose up -d redis` "
            "or set AI_API_TEST_REDIS_URL"
        )
