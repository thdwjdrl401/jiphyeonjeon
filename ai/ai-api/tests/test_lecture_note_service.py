import asyncio
from datetime import UTC, datetime

from app.captions import CaptionCompleted, CaptionDelta
from app.lecture_notes import (
    LectureNoteModelResult,
    LectureNotePipeline,
    LectureNoteService,
    LectureNoteStatus,
    LectureNoteWindow,
    LectureNoteWindowAccumulator,
    TopicAction,
    WindowFlushReason,
)

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
OCCURRED_AT = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)


class BlockingModel:
    def __init__(self) -> None:
        self.requests = []
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def generate(self, request):
        self.requests.append(request)
        self.started.set()
        await self.release.wait()
        return LectureNoteModelResult(
            topicAction=TopicAction.CONTINUE,
            topicTitle="주제",
            keyPoints=(request.text,),
        )


class RecordingStore:
    def __init__(self) -> None:
        self.snapshots = []

    async def save(self, snapshot) -> None:
        self.snapshots.append(snapshot)


def _window(sequence: int, text: str) -> LectureNoteWindow:
    return LectureNoteWindow(
        session_id=SESSION_ID,
        lesson_id=LESSON_ID,
        stt_session_id="attempt-1",
        start_sequence=sequence,
        end_sequence=sequence,
        start_stream_elapsed_ms=(sequence - 1) * 25_000,
        end_stream_elapsed_ms=sequence * 25_000,
        text=text,
        previous_context="",
        flush_reason=WindowFlushReason.TARGET_REACHED,
    )


def test_same_session_runs_one_model_call_and_coalesces_pending_windows() -> None:
    async def scenario() -> None:
        model = BlockingModel()
        store = RecordingStore()
        service = LectureNoteService(model, store)

        service.enqueue((_window(1, "하나"),))
        await model.started.wait()
        service.enqueue((_window(2, " 둘"),))
        service.enqueue((_window(3, " 셋"),))
        model.release.set()
        await service.drain()

        assert [request.text for request in model.requests] == ["하나", " 둘 셋"]
        assert [snapshot.noteVersion for snapshot in store.snapshots] == ["1", "2"]
        assert store.snapshots[-1].topics[0].keyPoints == ("하나", "둘 셋")

    asyncio.run(scenario())


def test_completion_without_remaining_text_saves_completed_snapshot() -> None:
    async def scenario() -> None:
        model = BlockingModel()
        model.release.set()
        store = RecordingStore()
        service = LectureNoteService(model, store)
        completion = CaptionCompleted(
            contractVersion="1",
            type="caption.stream.completed",
            eventId="completed-1",
            sessionId=SESSION_ID,
            lessonId=LESSON_ID,
            sttSessionId="attempt-1",
            lastSequence="0",
            streamElapsedMs="0",
            reason="ROOM_DELETED",
            occurredAt=datetime.now(UTC),
        )

        service.enqueue((), completion=completion)
        await service.drain()

        assert model.requests == []
        assert len(store.snapshots) == 1
        assert store.snapshots[0].status is LectureNoteStatus.COMPLETED
        assert store.snapshots[0].noteVersion == "1"
        assert service.metrics_snapshot()["tracked_sessions"] == 0

    asyncio.run(scenario())


def test_pipeline_ignores_replayed_completion_without_overwriting_note() -> None:
    async def scenario() -> None:
        model = BlockingModel()
        model.release.set()
        store = RecordingStore()
        service = LectureNoteService(model, store)
        pipeline = LectureNotePipeline(
            LectureNoteWindowAccumulator(
                min_window_ms=1,
                target_window_ms=1,
                max_window_ms=1,
                min_chars=1,
            ),
            service,
        )
        delta = CaptionDelta(
            contractVersion="1",
            type="caption.delta",
            eventId="delta-1",
            sessionId=SESSION_ID,
            lessonId=LESSON_ID,
            sttSessionId="attempt-1",
            sequence="1",
            streamElapsedMs="1",
            text="기존 노트",
            occurredAt=OCCURRED_AT,
        )
        completion = CaptionCompleted(
            contractVersion="1",
            type="caption.stream.completed",
            eventId="completed-1",
            sessionId=SESSION_ID,
            lessonId=LESSON_ID,
            sttSessionId="attempt-1",
            lastSequence="1",
            streamElapsedMs="2",
            reason="ROOM_DELETED",
            occurredAt=OCCURRED_AT,
        )

        pipeline.ingest(delta)
        await service.drain()
        pipeline.ingest(completion)
        await service.drain()
        completed_snapshot = store.snapshots[-1]

        pipeline.ingest(completion)
        await service.drain()

        assert len(store.snapshots) == 2
        assert store.snapshots[-1] == completed_snapshot
        assert completed_snapshot.topics[0].keyPoints == ("기존 노트",)
        assert completed_snapshot.noteVersion == "2"

    asyncio.run(scenario())


def test_model_validation_failure_keeps_previous_note_for_next_window() -> None:
    class ValidationFailingModel:
        def __init__(self) -> None:
            self.calls = 0

        async def generate(self, request):
            self.calls += 1
            if self.calls == 2:
                return LectureNoteModelResult.model_validate(
                    {
                        "topicAction": "INVALID",
                        "topicTitle": "주제",
                        "keyPoints": ["훼손되면 안 됨"],
                    }
                )
            return LectureNoteModelResult(
                topicAction=TopicAction.CONTINUE,
                topicTitle="주제",
                keyPoints=(request.text,),
            )

    async def scenario() -> None:
        model = ValidationFailingModel()
        store = RecordingStore()
        service = LectureNoteService(model, store)

        service.enqueue((_window(1, "첫째"),))
        await service.drain()
        service.enqueue((_window(2, "실패"),))
        await service.drain()
        service.enqueue((_window(3, "셋째"),))
        await service.drain()

        assert model.calls == 3
        assert [snapshot.noteVersion for snapshot in store.snapshots] == ["1", "2"]
        assert store.snapshots[-1].topics[0].keyPoints == ("첫째", "셋째")
        assert service.metrics_snapshot()["model_failures_total"] == 1

    asyncio.run(scenario())
