import asyncio
import json
from datetime import UTC, datetime

from app.adapters.redis_lecture_note_store import RedisLectureNoteSnapshotStore
from app.lecture_notes import (
    LectureNoteSnapshot,
    LectureNoteSnapshotTopic,
    LectureNoteStatus,
)

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"


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
