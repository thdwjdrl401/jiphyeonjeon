import json
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.captions import CaptionContextStore, IngestOutcome, parse_caption_entry

FIXTURES_DIR = Path(__file__).parents[2] / "realtime-agent" / "contracts" / "fixtures"
SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
OTHER_LESSON_ID = "33333333-3333-4333-8333-333333333333"


def _fixture(name: str) -> dict[str, str]:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def _delta(
    sequence: int,
    stream_elapsed_ms: int,
    text: str,
    *,
    session_id: str = SESSION_ID,
    lesson_id: str = LESSON_ID,
    stt_session_id: str = "provider-attempt-1",
    event_id: str | None = None,
    occurred_at: str = "2026-07-27T12:34:56.789Z",
) -> dict[str, str]:
    payload = _fixture("caption-delta.valid.json")
    payload.update(
        eventId=event_id or f"event-{stt_session_id}-{sequence}",
        sessionId=session_id,
        lessonId=lesson_id,
        sttSessionId=stt_session_id,
        sequence=str(sequence),
        streamElapsedMs=str(stream_elapsed_ms),
        text=text,
        occurredAt=occurred_at,
    )
    return payload


def _completed(
    last_sequence: int,
    stream_elapsed_ms: int,
    *,
    stt_session_id: str = "provider-attempt-1",
    event_id: str | None = None,
) -> dict[str, str]:
    payload = _fixture("caption-completed.valid.json")
    payload.update(
        eventId=event_id or f"completed-{stt_session_id}-{last_sequence}",
        sessionId=SESSION_ID,
        lessonId=LESSON_ID,
        sttSessionId=stt_session_id,
        lastSequence=str(last_sequence),
        streamElapsedMs=str(stream_elapsed_ms),
    )
    return payload


def test_parser_consumes_current_realtime_agent_fixture_and_preserves_whitespace() -> None:
    payload = {
        key.encode(): value.encode() for key, value in _fixture("caption-delta.valid.json").items()
    }

    entry = parse_caption_entry(payload)

    assert entry.text == " 외"
    assert entry.streamElapsedMs == "41000"
    assert entry.sttSessionId == "openai-realtime:session-1"


@pytest.mark.parametrize(
    ("field_name", "payload_factory"),
    [
        ("sequence", lambda: _delta(1, 1, "문장")),
        ("streamElapsedMs", lambda: _delta(1, 1, "문장")),
        ("lastSequence", lambda: _completed(1, 1)),
        ("streamElapsedMs", lambda: _completed(1, 1)),
    ],
)
def test_parser_bounds_numeric_strings_to_eighteen_digits(
    field_name: str,
    payload_factory: Callable[[], dict[str, str]],
) -> None:
    accepted = payload_factory()
    accepted[field_name] = "9" * 18
    rejected = payload_factory()
    rejected[field_name] = "9" * 19

    parse_caption_entry(accepted)
    with pytest.raises(ValidationError):
        parse_caption_entry(rejected)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda payload: payload.update(sequence=1),
        lambda payload: payload.update(sequence="01"),
        lambda payload: payload.update(contractVersion="2"),
        lambda payload: payload.update(extra="not-allowed"),
        lambda payload: payload.update(sessionId="session-1"),
        lambda payload: payload.pop("sttSessionId"),
        lambda payload: payload.update(audioEndMs=payload.pop("streamElapsedMs")),
        lambda payload: payload.update(delta=payload.pop("text")),
    ],
)
def test_parser_rejects_values_outside_current_producer_contract(mutation) -> None:
    payload = _delta(1, 10, "문장")
    mutation(payload)

    with pytest.raises((ValidationError, ValueError)):
        parse_caption_entry(payload)


def test_query_is_inclusive_bounded_and_uses_stream_elapsed_coordinate() -> None:
    store = CaptionContextStore(lookback_ms=300_000)
    for sequence, stream_elapsed_ms, text in [
        (1, 100_000, "시작"),
        (2, 400_000, " 문장"),
        (3, 400_001, "."),
    ]:
        store.ingest(parse_caption_entry(_delta(sequence, stream_elapsed_ms, text)))

    result = store.query(SESSION_ID, 400_000)

    assert [item.sequence for item in result.items] == [1, 2]
    assert result.text == "시작 문장"
    assert result.first_stream_elapsed_ms == 100_000
    assert result.last_stream_elapsed_ms == 400_000
    assert str(result.lesson_id) == LESSON_ID
    assert result.stt_session_id == "provider-attempt-1"


def test_duplicate_sequence_conflict_and_gap_do_not_duplicate_text() -> None:
    store = CaptionContextStore()
    first = parse_caption_entry(_delta(1, 1_000, "하나"))
    same_sequence = parse_caption_entry(
        _delta(1, 1_000, "하나", event_id="same-sequence-new-event")
    )
    conflicting_sequence = parse_caption_entry(_delta(1, 1_000, "변조", event_id="conflict-event"))

    assert store.ingest(first) is IngestOutcome.APPENDED
    assert store.ingest(first) is IngestOutcome.DUPLICATE_EVENT
    assert store.ingest(same_sequence) is IngestOutcome.DUPLICATE_SEQUENCE
    assert store.ingest(conflicting_sequence) is IngestOutcome.CONFLICT
    assert store.ingest(parse_caption_entry(_delta(3, 3_000, " 셋"))) is IngestOutcome.APPENDED

    result = store.query(SESSION_ID, 3_000)
    assert result.text == "하나 셋"
    assert result.incomplete is True
    assert store.metrics_snapshot()["sequence_missing_total"] == 1


def test_session_cannot_switch_lesson_scope() -> None:
    store = CaptionContextStore()
    store.ingest(parse_caption_entry(_delta(1, 1_000, "정상")))

    outcome = store.ingest(
        parse_caption_entry(
            _delta(2, 2_000, " 유출", lesson_id=OTHER_LESSON_ID, event_id="cross-lesson")
        )
    )

    assert outcome is IngestOutcome.CONFLICT
    assert store.query(SESSION_ID, 2_000).text == "정상"
    assert store.query(SESSION_ID, 2_000).incomplete is True


def test_new_attempt_restarts_sequence_and_late_old_attempt_is_rejected() -> None:
    store = CaptionContextStore()
    store.ingest(parse_caption_entry(_delta(1, 1_000, "이전")))

    replacement = store.ingest(
        parse_caption_entry(
            _delta(
                1,
                100,
                "새 시도",
                stt_session_id="provider-attempt-2",
                occurred_at="2026-07-27T12:35:56.789Z",
            )
        )
    )
    stale = store.ingest(parse_caption_entry(_delta(2, 2_000, " 늦은 이전", event_id="late-old")))

    result = store.query(SESSION_ID, 100)
    assert replacement is IngestOutcome.APPENDED
    assert stale is IngestOutcome.STALE_ATTEMPT
    assert result.text == "새 시도"
    assert result.stt_session_id == "provider-attempt-2"
    assert result.incomplete is True
    assert store.metrics_snapshot()["attempt_replaced_incomplete_total"] == 1


def test_completed_attempt_can_be_replaced_without_marking_new_attempt_incomplete() -> None:
    store = CaptionContextStore()
    store.ingest(parse_caption_entry(_delta(1, 1_000, "이전")))
    store.ingest(parse_caption_entry(_completed(1, 1_000)))

    store.ingest(
        parse_caption_entry(
            _delta(
                1,
                100,
                "새 시도",
                stt_session_id="provider-attempt-2",
                occurred_at="2026-07-27T12:35:56.789Z",
            )
        )
    )

    result = store.query(SESSION_ID, 100)
    assert result.text == "새 시도"
    assert result.incomplete is False


def test_old_attempt_cannot_return_after_bounded_tombstone_eviction() -> None:
    store = CaptionContextStore(max_retired_attempts_per_session=1)
    store.ingest(parse_caption_entry(_delta(1, 1, "attempt-1")))
    store.ingest(
        parse_caption_entry(
            _delta(
                1,
                1,
                "attempt-2",
                stt_session_id="provider-attempt-2",
                occurred_at="2026-07-27T12:35:56.789Z",
            )
        )
    )
    store.ingest(
        parse_caption_entry(
            _delta(
                1,
                1,
                "attempt-3",
                stt_session_id="provider-attempt-3",
                occurred_at="2026-07-27T12:36:56.789Z",
            )
        )
    )

    outcome = store.ingest(
        parse_caption_entry(
            _delta(
                2,
                2,
                "late-attempt-1",
                event_id="very-late-old-attempt",
                occurred_at="2026-07-27T12:34:57.789Z",
            )
        )
    )

    assert outcome is IngestOutcome.STALE_ATTEMPT
    assert store.query(SESSION_ID, 2).text == "attempt-3"


def test_completion_and_stream_regression_are_observed() -> None:
    store = CaptionContextStore()
    store.ingest(parse_caption_entry(_delta(1, 2_000, "정상")))

    regression = store.ingest(parse_caption_entry(_delta(2, 1_000, "역행")))
    store.ingest(parse_caption_entry(_completed(1, 2_000)))
    late = store.ingest(parse_caption_entry(_delta(2, 3_000, " 늦음", event_id="late")))

    result = store.query(SESSION_ID, 3_000)
    assert regression is IngestOutcome.STREAM_REGRESSION
    assert late is IngestOutcome.AFTER_COMPLETION
    assert result.text == "정상"
    assert result.completed is True
    assert result.incomplete is True


def test_event_byte_and_session_limits_evict_oldest_context() -> None:
    event_limited = CaptionContextStore(max_events_per_session=2)
    for sequence in range(1, 4):
        event_limited.ingest(parse_caption_entry(_delta(sequence, sequence, str(sequence))))

    byte_limited = CaptionContextStore(max_bytes_per_session=4)
    byte_limited.ingest(parse_caption_entry(_delta(1, 1, "가")))
    byte_limited.ingest(parse_caption_entry(_delta(2, 2, "나")))

    session_limited = CaptionContextStore(max_sessions=1)
    session_limited.ingest(parse_caption_entry(_delta(1, 1, "A")))
    session_limited.ingest(
        parse_caption_entry(
            _delta(
                1,
                1,
                "B",
                session_id="44444444-4444-4444-8444-444444444444",
                event_id="other-session",
            )
        )
    )

    assert event_limited.query(SESSION_ID, 3).text == "23"
    assert event_limited.query(SESSION_ID, 3).truncated is True
    assert byte_limited.query(SESSION_ID, 2).text == "나"
    assert byte_limited.query(SESSION_ID, 2).truncated is True
    assert session_limited.query(SESSION_ID, 1).known_session is False
