from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.captions.models import CaptionDelta, CaptionStreamCompleted
from app.captions.pipeline import CaptionEventMapper
from app.stt.engine import EngineCompleted, EngineWarning, TextDelta

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
NOW = datetime(2026, 7, 27, 12, 34, 56, 789000, tzinfo=UTC)


class RecordingPublisher:
    def __init__(self, failure: BaseException | None = None) -> None:
        self.deltas: list[CaptionDelta] = []
        self.completed: list[CaptionStreamCompleted] = []
        self.failure = failure

    async def publish_delta(self, event: CaptionDelta) -> None:
        self.deltas.append(event)
        if self.failure is not None:
            raise self.failure

    async def publish_completed(self, event: CaptionStreamCompleted) -> None:
        self.completed.append(event)
        if self.failure is not None:
            raise self.failure


def mapper(
    publisher: RecordingPublisher,
    ids: list[str],
    *,
    stt_session_id: str = "stt-1",
) -> CaptionEventMapper:
    event_ids = iter(ids)
    return CaptionEventMapper(
        publisher,
        session_id=SESSION_ID,
        lesson_id=LESSON_ID,
        stt_session_id=stt_session_id,
        event_id_factory=lambda: next(event_ids),
        clock=lambda: NOW,
    )


async def test_maps_single_consumer_events_to_gapless_sequence_and_completion() -> None:
    publisher = RecordingPublisher()
    sink = mapper(publisher, ["event-1", "event-2", "event-3"])

    await sink(TextDelta("안녕", 20))
    await sink(EngineWarning("PROVIDER_NOTICE", "ignored for caption transport"))
    await sink(TextDelta(" 하세요", 40))
    completed = await sink.publish_completed(EngineCompleted(40))

    assert [event.sequence for event in publisher.deltas] == [1, 2]
    assert [event.text for event in publisher.deltas] == ["안녕", " 하세요"]
    assert completed.last_sequence == 2
    assert completed.stt_session_id == "stt-1"
    assert completed.stream_elapsed_ms == 40
    assert publisher.completed == [completed]


async def test_rejects_empty_text_before_publish_without_consuming_sequence() -> None:
    publisher = RecordingPublisher()
    sink = mapper(publisher, ["event-1", "event-2"])

    with pytest.raises(ValueError, match="must not be empty"):
        await sink(TextDelta("", 20))
    event = await sink.publish_delta(TextDelta(" ", 20))

    assert event.sequence == 1
    assert event.text == " "


async def test_fails_closed_on_regressing_stream_clock_but_allows_equal_time() -> None:
    publisher = RecordingPublisher()
    sink = mapper(publisher, ["event-1", "event-2", "event-3"])
    await sink.publish_delta(TextDelta("first", 20))

    with pytest.raises(ValueError, match="must not regress"):
        await sink.publish_delta(TextDelta("regressed", 19))
    equal = await sink.publish_delta(TextDelta("equal", 20))

    assert equal.sequence == 2
    assert [event.text for event in publisher.deltas] == ["first", "equal"]


async def test_fails_closed_when_completion_clock_regresses() -> None:
    publisher = RecordingPublisher()
    sink = mapper(publisher, ["event-1", "event-2"])
    await sink.publish_delta(TextDelta("first", 20))

    with pytest.raises(ValueError, match="must not regress"):
        await sink.publish_completed(EngineCompleted(19))

    assert publisher.completed == []


async def test_publish_failure_does_not_advance_sequence() -> None:
    publisher = RecordingPublisher(ConnectionError("redis unavailable"))
    sink = mapper(publisher, ["event-1", "event-2"])

    with pytest.raises(ConnectionError, match="redis unavailable"):
        await sink.publish_delta(TextDelta("first", 20))

    assert sink.sequence == 0
    assert sink.last_stream_elapsed_ms == 0


async def test_rejects_events_after_successful_completion() -> None:
    publisher = RecordingPublisher()
    sink = mapper(publisher, ["event-1", "event-2"])
    await sink.publish_completed(EngineCompleted(0))

    with pytest.raises(RuntimeError, match="already completed"):
        await sink.publish_delta(TextDelta("late", 1))


async def test_sequential_attempts_restart_sequence_under_distinct_stt_session_ids() -> None:
    publisher = RecordingPublisher()
    first_attempt = mapper(
        publisher,
        ["attempt-1-delta", "attempt-1-completed"],
        stt_session_id="stt-attempt-1",
    )
    second_attempt = mapper(
        publisher,
        ["attempt-2-delta", "attempt-2-completed"],
        stt_session_id="stt-attempt-2",
    )

    first_delta = await first_attempt.publish_delta(TextDelta("first", 10))
    first_completed = await first_attempt.publish_completed(EngineCompleted(10))
    second_delta = await second_attempt.publish_delta(TextDelta("retry", 20))
    second_completed = await second_attempt.publish_completed(EngineCompleted(20))

    assert (first_delta.stt_session_id, first_delta.sequence) == ("stt-attempt-1", 1)
    assert (second_delta.stt_session_id, second_delta.sequence) == ("stt-attempt-2", 1)
    assert (first_completed.stt_session_id, first_completed.last_sequence) == (
        "stt-attempt-1",
        1,
    )
    assert (second_completed.stt_session_id, second_completed.last_sequence) == (
        "stt-attempt-2",
        1,
    )
