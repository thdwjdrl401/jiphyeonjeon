from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.adapters.redis_caption_publisher import to_stream_fields
from app.captions.models import (
    MAX_CONTRACT_INTEGER,
    CaptionDelta,
    CaptionStreamCompleted,
)

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
OCCURRED_AT = datetime(2026, 7, 27, 12, 34, 56, 789000, tzinfo=UTC)


def delta(**changes: object) -> CaptionDelta:
    values: dict[str, object] = {
        "event_id": "caption-event-1",
        "session_id": SESSION_ID,
        "lesson_id": LESSON_ID,
        "stt_session_id": "openai-realtime:session-1",
        "sequence": 1,
        "stream_elapsed_ms": 41_000,
        "text": " 외",
        "occurred_at": OCCURRED_AT,
    }
    values.update(changes)
    return CaptionDelta(**values)  # type: ignore[arg-type]


def test_delta_serializes_to_exact_candidate_contract_and_preserves_whitespace() -> None:
    assert to_stream_fields(delta()) == {
        "contractVersion": "1",
        "eventId": "caption-event-1",
        "type": "caption.delta",
        "sessionId": "11111111-1111-4111-8111-111111111111",
        "lessonId": "22222222-2222-4222-8222-222222222222",
        "sttSessionId": "openai-realtime:session-1",
        "sequence": "1",
        "streamElapsedMs": "41000",
        "text": " 외",
        "occurredAt": "2026-07-27T12:34:56.789Z",
    }


def test_completed_serializes_with_attempt_identity() -> None:
    event = CaptionStreamCompleted(
        event_id="caption-event-2",
        session_id=SESSION_ID,
        lesson_id=LESSON_ID,
        stt_session_id="openai-realtime:session-1",
        last_sequence=1,
        stream_elapsed_ms=41_000,
        reason="ROOM_DELETED",
        occurred_at=OCCURRED_AT,
    )

    assert to_stream_fields(event) == {
        "contractVersion": "1",
        "eventId": "caption-event-2",
        "type": "caption.stream.completed",
        "sessionId": "11111111-1111-4111-8111-111111111111",
        "lessonId": "22222222-2222-4222-8222-222222222222",
        "sttSessionId": "openai-realtime:session-1",
        "lastSequence": "1",
        "streamElapsedMs": "41000",
        "reason": "ROOM_DELETED",
        "occurredAt": "2026-07-27T12:34:56.789Z",
    }


def test_rejects_empty_text_but_preserves_whitespace_only_text() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        delta(text="")

    assert delta(text="   ").text == "   "


def test_rejects_unimplemented_completion_reason() -> None:
    with pytest.raises(ValueError, match="ROOM_DELETED"):
        CaptionStreamCompleted(
            event_id="caption-event-2",
            session_id=SESSION_ID,
            lesson_id=LESSON_ID,
            stt_session_id="openai-realtime:session-1",
            last_sequence=0,
            stream_elapsed_ms=0,
            reason="SESSION_ENDED",
            occurred_at=OCCURRED_AT,
        )


@pytest.mark.parametrize("field", ["sequence", "stream_elapsed_ms"])
def test_caption_integers_are_limited_to_18_decimal_digits(field: str) -> None:
    assert getattr(delta(**{field: MAX_CONTRACT_INTEGER}), field) == MAX_CONTRACT_INTEGER

    with pytest.raises(ValueError, match="must be between"):
        delta(**{field: MAX_CONTRACT_INTEGER + 1})
    with pytest.raises(TypeError, match="must be an integer"):
        delta(**{field: True})
