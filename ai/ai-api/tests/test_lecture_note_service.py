import asyncio
from datetime import UTC, datetime

from app.captions import CaptionCompleted, CaptionDelta
from app.lecture_notes import (
    LectureNoteCaptureCompleted,
    LectureNoteChunkAppended,
    LectureNoteDecisionAction,
    LectureNoteModelResult,
    LectureNotePipeline,
    LectureNoteService,
    LectureNoteWindowAccumulator,
)
from app.lecture_notes.recovery import LectureNoteSessionCheckpoint

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
OCCURRED_AT = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)


class ImmediateModel:
    def __init__(self) -> None:
        self.requests = []

    async def generate(self, request):
        self.requests.append(request)
        return LectureNoteModelResult(
            action=LectureNoteDecisionAction.APPEND,
            topicTitle="주제",
            keyPoints=(request.text,),
        )


class BlockingModel(ImmediateModel):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def generate(self, request):
        self.requests.append(request)
        self.started.set()
        await self.release.wait()
        return LectureNoteModelResult(
            action=LectureNoteDecisionAction.APPEND,
            topicTitle="주제",
            keyPoints=(request.text,),
        )


class InMemoryStore:
    def __init__(self) -> None:
        self.checkpoints: dict[str, LectureNoteSessionCheckpoint] = {}
        self.events = []
        self.commit_failures = 0
        self.commit_response_losses = 0
        self.deactivated = []

    async def save(self, checkpoint) -> None:
        self.checkpoints[checkpoint.sessionId] = _copy_checkpoint(checkpoint)

    async def commit(self, checkpoint, event) -> None:
        if self.commit_failures:
            self.commit_failures -= 1
            raise RuntimeError("commit failed")
        self.checkpoints[checkpoint.sessionId] = _copy_checkpoint(checkpoint)
        self.events.append(event)
        if self.commit_response_losses:
            self.commit_response_losses -= 1
            raise RuntimeError("commit response lost")

    async def load_active(self):
        return tuple(self.checkpoints.values())

    async def load(self, session_id):
        return self.checkpoints.get(session_id)

    async def deactivate(self, session_id) -> None:
        self.checkpoints.pop(session_id, None)
        self.deactivated.append(session_id)


def _copy_checkpoint(checkpoint) -> LectureNoteSessionCheckpoint:
    return LectureNoteSessionCheckpoint.model_validate_json(checkpoint.model_dump_json())


def _delta(sequence: int, text: str, *, elapsed_ms: int | None = None) -> CaptionDelta:
    return CaptionDelta(
        contractVersion="1",
        type="caption.delta",
        eventId=f"delta-{sequence}",
        sessionId=SESSION_ID,
        lessonId=LESSON_ID,
        sttSessionId="attempt-1",
        sequence=str(sequence),
        streamElapsedMs=str(elapsed_ms if elapsed_ms is not None else sequence),
        text=text,
        occurredAt=OCCURRED_AT,
    )


def _completion(last_sequence: int) -> CaptionCompleted:
    return CaptionCompleted(
        contractVersion="1",
        type="caption.stream.completed",
        eventId="completed-1",
        sessionId=SESSION_ID,
        lessonId=LESSON_ID,
        sttSessionId="attempt-1",
        lastSequence=str(last_sequence),
        streamElapsedMs=str(last_sequence + 1),
        reason="ROOM_DELETED",
        occurredAt=OCCURRED_AT,
    )


def _components(model, store, *, min_chars: int = 1):
    accumulator = LectureNoteWindowAccumulator(
        min_window_ms=1,
        target_window_ms=1,
        max_window_ms=40_000,
        min_chars=min_chars,
    )
    service = LectureNoteService(model, store, accumulator)
    return service, LectureNotePipeline(accumulator, service)


def test_same_session_runs_one_model_call_and_coalesces_pending_windows() -> None:
    async def scenario() -> None:
        model = BlockingModel()
        store = InMemoryStore()
        service, pipeline = _components(model, store)

        await pipeline.ingest(_delta(1, "하나"))
        await model.started.wait()
        await pipeline.ingest(_delta(2, " 둘"))
        await pipeline.ingest(_delta(3, " 셋"))
        model.release.set()
        await service.drain()

        assert [request.text for request in model.requests] == ["하나", " 둘 셋"]
        assert [event.chunkSequence for event in store.events] == ["1", "2"]
        assert store.events[0].markdownFragment == "## 주제\n\n- 하나"
        assert store.events[1].markdownFragment == "- 둘 셋"

    asyncio.run(scenario())


def test_partial_caption_is_restored_before_next_delta() -> None:
    async def scenario() -> None:
        store = InMemoryStore()
        first_model = ImmediateModel()
        first_service, first_pipeline = _components(first_model, store, min_chars=20)

        await first_pipeline.ingest(_delta(1, "Redis "))
        await first_service.drain()

        restored_model = ImmediateModel()
        restored_service, restored_pipeline = _components(restored_model, store, min_chars=20)
        await restored_pipeline.restore()
        await restored_pipeline.ingest(_delta(2, "Stream을 학습합니다.", elapsed_ms=40_000))
        await restored_service.drain()

        assert [request.text for request in restored_model.requests] == [
            "Redis Stream을 학습합니다."
        ]
        assert store.events[0].chunkSequence == "1"

    asyncio.run(scenario())


def test_in_flight_window_is_reprocessed_after_restart() -> None:
    class FailingModel:
        async def generate(self, request):
            raise RuntimeError("process stopped during model call")

    async def scenario() -> None:
        store = InMemoryStore()
        first_service, first_pipeline = _components(FailingModel(), store)

        await first_pipeline.ingest(_delta(1, "복구할 내용"))
        await first_service.drain()

        assert store.checkpoints[SESSION_ID].inFlight is not None
        restored_model = ImmediateModel()
        restored_service, restored_pipeline = _components(restored_model, store)
        await restored_pipeline.restore()
        await restored_service.drain()

        assert [request.text for request in restored_model.requests] == ["복구할 내용"]
        assert len(store.events) == 1

    asyncio.run(scenario())


def test_outbox_reuses_same_event_without_second_model_call() -> None:
    async def scenario() -> None:
        store = InMemoryStore()
        store.commit_failures = 1
        first_model = ImmediateModel()
        first_service, first_pipeline = _components(first_model, store)

        await first_pipeline.ingest(_delta(1, "원자 발행"))
        await first_service.drain()

        saved_event = store.checkpoints[SESSION_ID].outbox
        assert isinstance(saved_event, LectureNoteChunkAppended)
        assert store.events == []

        restored_model = ImmediateModel()
        restored_service, restored_pipeline = _components(restored_model, store)
        await restored_pipeline.restore()
        await restored_service.drain()

        assert restored_model.requests == []
        assert store.events[0].eventId == saved_event.eventId
        assert store.checkpoints[SESSION_ID].outbox is None

    asyncio.run(scenario())


def test_ignore_completes_operation_without_event_or_chunk_sequence() -> None:
    class IgnoreModel:
        async def generate(self, request):
            return LectureNoteModelResult(action=LectureNoteDecisionAction.IGNORE)

    async def scenario() -> None:
        store = InMemoryStore()
        service, pipeline = _components(IgnoreModel(), store)

        await pipeline.ingest(_delta(1, "반복 안내"))
        await service.drain()

        checkpoint = store.checkpoints[SESSION_ID]
        assert checkpoint.inFlight is None
        assert checkpoint.pending is None
        assert checkpoint.outbox is None
        assert checkpoint.note.chunk_sequence == 0
        assert store.events == []

    asyncio.run(scenario())


def test_lost_commit_response_is_reconciled_without_duplicate_event() -> None:
    async def scenario() -> None:
        store = InMemoryStore()
        store.commit_response_losses = 1
        model = ImmediateModel()
        service, pipeline = _components(model, store)

        await pipeline.ingest(_delta(1, "응답 유실"))
        await service.drain()
        await pipeline.ingest(_delta(2, " 다음 내용"))
        await service.drain()

        assert [event.chunkSequence for event in store.events] == ["1", "2"]
        assert len({event.eventId for event in store.events}) == 2
        assert service.metrics_snapshot()["publish_failures_total"] == 0

    asyncio.run(scenario())


def test_completion_is_deactivated_only_after_note_commit_and_caption_ack() -> None:
    async def scenario() -> None:
        model = ImmediateModel()
        store = InMemoryStore()
        service, pipeline = _components(model, store)
        completion = _completion(1)

        await pipeline.ingest(_delta(1, "마지막 내용"))
        await service.drain()
        await pipeline.ingest(completion)
        await pipeline.after_ack(completion)
        await service.drain()

        assert isinstance(store.events[0], LectureNoteChunkAppended)
        assert isinstance(store.events[1], LectureNoteCaptureCompleted)
        assert store.events[1].lastChunkSequence == "1"
        assert store.deactivated == [SESSION_ID]

        await pipeline.ingest(completion)
        await pipeline.after_ack(completion)
        await service.drain()
        assert len(store.events) == 2

    asyncio.run(scenario())
