import asyncio
from datetime import UTC, datetime

from app.captions import CaptionCompleted, CaptionDelta
from app.lecture_notes import (
    LectureNoteCaptureCompleted,
    LectureNoteChunkAppended,
    LectureNoteDecisionAction,
    LectureNoteModelResult,
    LectureNotePipeline,
    LectureNoteRefinedSnapshot,
    LectureNoteRefinementResult,
    LectureNoteRefinementTopic,
    LectureNoteService,
    LectureNoteWindowAccumulator,
)
from app.lecture_notes.recovery import LectureNoteSessionCheckpoint

SESSION_ID = "11111111-1111-4111-8111-111111111111"
OTHER_SESSION_ID = "33333333-3333-4333-8333-333333333333"
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


class RefiningModel(ImmediateModel):
    def __init__(self) -> None:
        super().__init__()
        self.refinement_requests = []

    async def refine(self, request):
        self.refinement_requests.append(request)
        return LectureNoteRefinementResult(
            topics=(
                LectureNoteRefinementTopic(
                    topicTitle="정제된 주제",
                    keyPoints=("중복을 제거한 요점이다.",),
                ),
                LectureNoteRefinementTopic(
                    topicTitle="후속 주제",
                    keyPoints=("학습 순서를 유지한 후속 요점이다.",),
                ),
            )
        )


class FailingRefiningModel(ImmediateModel):
    async def refine(self, request):
        raise RuntimeError("refinement failed")


class InMemoryStore:
    def __init__(self) -> None:
        self.checkpoints: dict[str, LectureNoteSessionCheckpoint] = {}
        self.events = []
        self.commit_failures = 0
        self.commit_response_losses = 0
        self.lose_response_event_type = None
        self.fail_event_type = None
        self.deactivated = []

    async def save(self, checkpoint) -> None:
        self.checkpoints[checkpoint.sessionId] = _copy_checkpoint(checkpoint)

    async def commit(self, checkpoint, event) -> None:
        if event.type == self.fail_event_type:
            self.fail_event_type = None
            raise RuntimeError("selected event commit failed")
        if self.commit_failures:
            self.commit_failures -= 1
            raise RuntimeError("commit failed")
        self.checkpoints[checkpoint.sessionId] = _copy_checkpoint(checkpoint)
        self.events.append(event)
        if event.type == self.lose_response_event_type:
            self.lose_response_event_type = None
            raise RuntimeError("selected event commit response lost")
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


def _delta(
    sequence: int,
    text: str,
    *,
    elapsed_ms: int | None = None,
    session_id: str = SESSION_ID,
) -> CaptionDelta:
    return CaptionDelta(
        contractVersion="1",
        type="caption.delta",
        eventId=f"delta-{session_id}-{sequence}",
        sessionId=session_id,
        lessonId=LESSON_ID,
        sttSessionId="attempt-1",
        sequence=str(sequence),
        streamElapsedMs=str(elapsed_ms if elapsed_ms is not None else sequence),
        text=text,
        occurredAt=OCCURRED_AT,
    )


def _completion(
    last_sequence: int,
    *,
    session_id: str = SESSION_ID,
) -> CaptionCompleted:
    return CaptionCompleted(
        contractVersion="1",
        type="caption.stream.completed",
        eventId=f"completed-{session_id}",
        sessionId=session_id,
        lessonId=LESSON_ID,
        sttSessionId="attempt-1",
        lastSequence=str(last_sequence),
        streamElapsedMs=str(last_sequence + 1),
        reason="ROOM_DELETED",
        occurredAt=OCCURRED_AT,
    )


def _components(model, store, *, min_chars: int = 1, refinement_model=None):
    accumulator = LectureNoteWindowAccumulator(
        min_window_ms=1,
        target_window_ms=1,
        max_window_ms=40_000,
        min_chars=min_chars,
    )
    service = LectureNoteService(
        model,
        store,
        accumulator,
        refinement_model=refinement_model,
    )
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
        assert service.metrics_snapshot()["tracked_sessions"] == 0

        await pipeline.ingest(_delta(2, " 종료 뒤 늦은 자막"))
        await pipeline.ingest(completion)
        await pipeline.after_ack(completion)
        await service.drain()
        assert len(store.events) == 2
        assert model.requests[-1].text == "마지막 내용"
        assert service.metrics_snapshot()["tracked_sessions"] == 0

    asyncio.run(scenario())


def test_completion_releases_only_the_target_session() -> None:
    async def scenario() -> None:
        model = ImmediateModel()
        store = InMemoryStore()
        service, pipeline = _components(model, store)
        first_completion = _completion(1)
        other_completion = _completion(1, session_id=OTHER_SESSION_ID)

        await pipeline.ingest(_delta(1, "첫 세션", session_id=SESSION_ID))
        await pipeline.ingest(_delta(1, "둘째 세션", session_id=OTHER_SESSION_ID))
        await service.drain()
        assert service.metrics_snapshot()["tracked_sessions"] == 2

        await pipeline.ingest(first_completion)
        await pipeline.after_ack(first_completion)
        await service.drain()

        assert service.metrics_snapshot()["tracked_sessions"] == 1
        assert store.deactivated == [SESSION_ID]
        assert OTHER_SESSION_ID in store.checkpoints

        await pipeline.ingest(other_completion)
        await pipeline.after_ack(other_completion)
        await service.drain()

        assert service.metrics_snapshot()["tracked_sessions"] == 0
        assert store.deactivated == [SESSION_ID, OTHER_SESSION_ID]

    asyncio.run(scenario())


def test_completion_publishes_refined_snapshot_after_live_events() -> None:
    async def scenario() -> None:
        model = RefiningModel()
        store = InMemoryStore()
        service, pipeline = _components(model, store, refinement_model=model)
        completion = _completion(1)

        await pipeline.ingest(_delta(1, "라이브 초안"))
        await service.drain()
        await pipeline.ingest(completion)
        await service.drain()

        assert [event.type for event in store.events] == [
            "lecture.note.chunk.appended",
            "lecture.note.capture.completed",
            "lecture.note.refined.snapshot",
        ]
        snapshot = store.events[-1]
        assert isinstance(snapshot, LectureNoteRefinedSnapshot)
        assert snapshot.sourceLastChunkSequence == "1"
        assert [topic.topicId for topic in snapshot.topics] == [
            "refined-topic-1",
            "refined-topic-2",
        ]
        assert snapshot.markdownSnapshot == (
            "## 정제된 주제\n\n- 중복을 제거한 요점이다.\n\n"
            "## 후속 주제\n\n- 학습 순서를 유지한 후속 요점이다."
        )
        assert len(model.refinement_requests) == 1
        assert store.deactivated == []
        assert store.checkpoints[SESSION_ID].refined is True
        assert store.checkpoints[SESSION_ID].completionAcked is False

        await pipeline.after_ack(completion)

        assert store.deactivated == [SESSION_ID]
        assert service.metrics_snapshot()["tracked_sessions"] == 0

    asyncio.run(scenario())


def test_completion_ack_is_reconciled_after_owned_pending_drain() -> None:
    async def scenario() -> None:
        store = InMemoryStore()
        first_service, first_pipeline = _components(ImmediateModel(), store)
        completion = _completion(1)

        await first_pipeline.ingest(_delta(1, "ACK 경계 복구"))
        await first_service.drain()
        await first_pipeline.ingest(completion)
        await first_service.drain()

        checkpoint = store.checkpoints[SESSION_ID]
        assert checkpoint.completed is True
        assert checkpoint.completionAcked is False
        assert store.deactivated == []

        restored_service, restored_pipeline = _components(ImmediateModel(), store)
        await restored_pipeline.restore()
        await restored_service.drain()
        assert store.deactivated == []

        # 같은 consumer의 pending을 모두 비운 뒤에도 completion이 없다면 이전 XACK은 끝난 것이다.
        await restored_pipeline.after_owned_pending_drained()

        assert store.deactivated == [SESSION_ID]

    asyncio.run(scenario())


def test_refinement_failure_is_resumed_after_restart() -> None:
    async def scenario() -> None:
        store = InMemoryStore()
        failing_model = FailingRefiningModel()
        first_service, first_pipeline = _components(
            failing_model,
            store,
            refinement_model=failing_model,
        )
        completion = _completion(1)

        await first_pipeline.ingest(_delta(1, "재시작할 정제 초안"))
        await first_service.drain()
        await first_pipeline.ingest(completion)
        await first_pipeline.after_ack(completion)
        await first_service.drain()

        checkpoint = store.checkpoints[SESSION_ID]
        assert checkpoint.refinementPending is True
        assert checkpoint.refined is False
        assert [event.type for event in store.events] == [
            "lecture.note.chunk.appended",
            "lecture.note.capture.completed",
        ]

        restored_model = RefiningModel()
        restored_service, restored_pipeline = _components(
            restored_model,
            store,
            refinement_model=restored_model,
        )
        await restored_pipeline.restore()
        await restored_service.drain()

        assert len(restored_model.refinement_requests) == 1
        assert isinstance(store.events[-1], LectureNoteRefinedSnapshot)
        assert store.deactivated == [SESSION_ID]

    asyncio.run(scenario())


def test_lost_refined_commit_response_is_reconciled_without_duplicate_snapshot() -> None:
    async def scenario() -> None:
        store = InMemoryStore()
        store.lose_response_event_type = "lecture.note.refined.snapshot"
        model = RefiningModel()
        service, pipeline = _components(model, store, refinement_model=model)
        completion = _completion(1)

        await pipeline.ingest(_delta(1, "응답 유실 정제 초안"))
        await service.drain()
        await pipeline.ingest(completion)
        await pipeline.after_ack(completion)
        await service.drain()

        refined_events = [
            event for event in store.events if isinstance(event, LectureNoteRefinedSnapshot)
        ]
        assert len(refined_events) == 1
        assert service.metrics_snapshot()["publish_failures_total"] == 0
        assert store.deactivated == [SESSION_ID]

    asyncio.run(scenario())


def test_empty_draft_skips_refinement_and_snapshot() -> None:
    class IgnoreModel:
        async def generate(self, request):
            return LectureNoteModelResult(action=LectureNoteDecisionAction.IGNORE)

        async def refine(self, request):
            raise AssertionError("empty draft must not call refinement")

    async def scenario() -> None:
        store = InMemoryStore()
        model = IgnoreModel()
        service, pipeline = _components(model, store, refinement_model=model)
        completion = _completion(1)

        await pipeline.ingest(_delta(1, "반복 안내"))
        await service.drain()
        await pipeline.ingest(completion)
        await pipeline.after_ack(completion)
        await service.drain()

        assert len(store.events) == 1
        assert isinstance(store.events[0], LectureNoteCaptureCompleted)
        assert store.events[0].lastChunkSequence == "0"
        assert store.deactivated == [SESSION_ID]

    asyncio.run(scenario())


def test_refined_outbox_is_restored_without_second_refinement_call() -> None:
    async def scenario() -> None:
        store = InMemoryStore()
        store.fail_event_type = "lecture.note.refined.snapshot"
        first_model = RefiningModel()
        first_service, first_pipeline = _components(
            first_model,
            store,
            refinement_model=first_model,
        )
        completion = _completion(1)

        await first_pipeline.ingest(_delta(1, "복구할 정제 초안"))
        await first_service.drain()
        await first_pipeline.ingest(completion)
        await first_pipeline.after_ack(completion)
        await first_service.drain()

        saved_event = store.checkpoints[SESSION_ID].outbox
        assert isinstance(saved_event, LectureNoteRefinedSnapshot)
        restored_model = RefiningModel()
        restored_service, restored_pipeline = _components(
            restored_model,
            store,
            refinement_model=restored_model,
        )
        await restored_pipeline.restore()
        await restored_service.drain()

        assert restored_model.refinement_requests == []
        assert store.events[-1].eventId == saved_event.eventId
        assert store.deactivated == [SESSION_ID]

    asyncio.run(scenario())
