from datetime import UTC, datetime

import pytest

from app.captions import CaptionCompleted, CaptionDelta
from app.lecture_notes import LectureNoteWindowAccumulator, WindowFlushReason

SESSION_ID = "11111111-1111-4111-8111-111111111111"
OTHER_SESSION_ID = "33333333-3333-4333-8333-333333333333"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
OCCURRED_AT = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)


def _delta(
    sequence: int,
    stream_elapsed_ms: int,
    text: str,
    *,
    stt_session_id: str = "attempt-1",
    event_id: str | None = None,
    session_id: str = SESSION_ID,
    lesson_id: str = LESSON_ID,
) -> CaptionDelta:
    return CaptionDelta(
        contractVersion="1",
        type="caption.delta",
        eventId=event_id or f"delta-{stt_session_id}-{sequence}",
        sessionId=session_id,
        lessonId=lesson_id,
        sttSessionId=stt_session_id,
        sequence=str(sequence),
        streamElapsedMs=str(stream_elapsed_ms),
        text=text,
        occurredAt=OCCURRED_AT,
    )


def _completed(
    last_sequence: int,
    stream_elapsed_ms: int,
    *,
    stt_session_id: str = "attempt-1",
    event_id: str | None = None,
    session_id: str = SESSION_ID,
    lesson_id: str = LESSON_ID,
) -> CaptionCompleted:
    return CaptionCompleted(
        contractVersion="1",
        type="caption.stream.completed",
        eventId=event_id or f"completed-{stt_session_id}-{last_sequence}",
        sessionId=session_id,
        lessonId=lesson_id,
        sttSessionId=stt_session_id,
        lastSequence=str(last_sequence),
        streamElapsedMs=str(stream_elapsed_ms),
        reason="ROOM_DELETED",
        occurredAt=OCCURRED_AT,
    )


def _windows(
    accumulator: LectureNoteWindowAccumulator,
    entry: CaptionDelta | CaptionCompleted,
):
    return accumulator.ingest(entry).windows


@pytest.mark.parametrize(
    ("stream_elapsed_ms", "text"),
    [
        (14_999, "가" * 79 + "."),
        (15_000, "가" * 78 + "."),
    ],
)
def test_strong_boundary_requires_both_minimum_time_and_characters(
    stream_elapsed_ms: int,
    text: str,
) -> None:
    accumulator = LectureNoteWindowAccumulator()

    assert _windows(accumulator, _delta(1, stream_elapsed_ms, text)) == ()


def test_target_time_flushes_without_strong_boundary_after_minimum_characters() -> None:
    accumulator = LectureNoteWindowAccumulator()

    windows = _windows(accumulator, _delta(1, 25_000, "가" * 80))

    assert len(windows) == 1
    assert windows[0].flush_reason is WindowFlushReason.TARGET_REACHED
    assert windows[0].text == "가" * 80


@pytest.mark.parametrize("ending", [".", "?", "!", "。", "？", "！", "\n"])
def test_strong_boundary_flushes_at_minimum_boundary(ending: str) -> None:
    accumulator = LectureNoteWindowAccumulator()

    windows = _windows(accumulator, _delta(1, 15_000, "가" * 79 + ending))

    assert len(windows) == 1
    assert windows[0].flush_reason is WindowFlushReason.STRONG_BOUNDARY
    assert windows[0].start_stream_elapsed_ms == 0
    assert windows[0].end_stream_elapsed_ms == 15_000


@pytest.mark.parametrize(
    ("stream_elapsed_ms", "text"),
    [
        (40_000, "짧은 구간"),
        (1_000, "가" * 400),
    ],
)
def test_forced_threshold_ignores_minimum_window(
    stream_elapsed_ms: int,
    text: str,
) -> None:
    accumulator = LectureNoteWindowAccumulator()

    windows = _windows(accumulator, _delta(1, stream_elapsed_ms, text))

    assert len(windows) == 1
    assert windows[0].flush_reason is WindowFlushReason.FORCED_THRESHOLD
    assert windows[0].text == text


def test_second_window_uses_elapsed_time_since_previous_flush() -> None:
    accumulator = LectureNoteWindowAccumulator()
    _windows(accumulator, _delta(1, 15_000, "가" * 79 + "."))

    assert _windows(accumulator, _delta(2, 16_000, "나" * 79 + ".")) == ()
    windows = _windows(accumulator, _delta(3, 30_000, "."))

    assert len(windows) == 1
    assert windows[0].start_sequence == 2
    assert windows[0].start_stream_elapsed_ms == 15_000
    assert windows[0].end_stream_elapsed_ms == 30_000


def test_completion_flushes_short_text_and_preserves_delta_whitespace() -> None:
    accumulator = LectureNoteWindowAccumulator()
    _windows(accumulator, _delta(1, 1_000, "첫째"))
    _windows(accumulator, _delta(2, 2_000, " 둘째"))

    windows = _windows(accumulator, _completed(2, 2_000))

    assert len(windows) == 1
    assert windows[0].flush_reason is WindowFlushReason.COMPLETED
    assert windows[0].text == "첫째 둘째"
    assert windows[0].start_sequence == 1
    assert windows[0].end_sequence == 2


def test_duplicate_event_sequence_and_gap_do_not_duplicate_text() -> None:
    accumulator = LectureNoteWindowAccumulator()
    first = _delta(1, 1_000, "하나")

    _windows(accumulator, first)
    assert _windows(accumulator, first) == ()
    assert _windows(accumulator, _delta(1, 1_000, "변조", event_id="other-event")) == ()
    _windows(accumulator, _delta(3, 3_000, " 셋"))
    windows = _windows(accumulator, _completed(3, 3_000))

    assert windows[0].text == "하나 셋"
    metrics = accumulator.metrics_snapshot()
    assert metrics["duplicate_event_total"] == 1
    assert metrics["duplicate_sequence_total"] == 1
    assert metrics["sequence_gap_total"] == 1
    assert metrics["sequence_missing_total"] == 1


def test_new_attempt_flushes_short_window_and_rejects_late_old_attempt() -> None:
    accumulator = LectureNoteWindowAccumulator()
    _windows(accumulator, _delta(1, 1_000, "이전 시도의 짧은 문장"))

    windows = _windows(
        accumulator,
        _delta(1, 100, "새 시도", stt_session_id="attempt-2"),
    )
    stale = _windows(accumulator, _delta(2, 2_000, " 늦은 이전"))

    assert len(windows) == 1
    assert windows[0].flush_reason is WindowFlushReason.ATTEMPT_CHANGED
    assert windows[0].stt_session_id == "attempt-1"
    assert windows[0].text == "이전 시도의 짧은 문장"
    assert stale == ()
    assert accumulator.metrics_snapshot()["stale_attempt_total"] == 1


def test_next_window_receives_only_previous_two_sentences_as_context() -> None:
    accumulator = LectureNoteWindowAccumulator()
    first_text = "가" * 30 + "." + "나" * 48 + "."
    first = _windows(accumulator, _delta(1, 15_000, first_text))

    _windows(accumulator, _delta(2, 16_000, "다음 내용"))
    second = _windows(accumulator, _completed(2, 16_000))

    assert first[0].previous_context == ""
    assert second[0].previous_context == "가" * 30 + ". " + "나" * 48 + "."


def test_sessions_keep_sequence_text_and_context_isolated() -> None:
    accumulator = LectureNoteWindowAccumulator()
    _windows(accumulator, _delta(1, 1_000, "세션 A"))
    _windows(
        accumulator,
        _delta(
            1,
            1_000,
            "세션 B",
            session_id=OTHER_SESSION_ID,
            event_id="other-session-delta",
        ),
    )

    session_a = _windows(accumulator, _completed(1, 2_000))
    session_b = _windows(
        accumulator,
        _completed(
            1,
            2_000,
            session_id=OTHER_SESSION_ID,
            event_id="other-session-completed",
        ),
    )

    assert session_a[0].session_id == SESSION_ID
    assert session_a[0].text == "세션 A"
    assert session_b[0].session_id == OTHER_SESSION_ID
    assert session_b[0].text == "세션 B"
    assert session_a[0].previous_context == session_b[0].previous_context == ""


def test_stream_regression_and_entry_after_completion_do_not_mutate_text() -> None:
    accumulator = LectureNoteWindowAccumulator()
    _windows(accumulator, _delta(1, 2_000, "정상"))
    _windows(accumulator, _delta(2, 1_000, " 역행"))

    completed = _windows(accumulator, _completed(1, 2_000))
    assert _windows(accumulator, _delta(2, 3_000, " 종료 뒤", event_id="after-completion")) == ()

    assert completed[0].text == "정상"
    metrics = accumulator.metrics_snapshot()
    assert metrics["stream_regression_total"] == 1
    assert metrics["after_completion_total"] == 1


def test_long_lived_state_is_bounded() -> None:
    accumulator = LectureNoteWindowAccumulator(
        max_sessions=1,
        max_event_ids=2,
        max_retired_attempts_per_session=1,
    )
    _windows(accumulator, _delta(1, 1_000, "첫 시도"))
    _windows(accumulator, _delta(1, 100, "둘째", stt_session_id="attempt-2"))
    _windows(accumulator, _delta(1, 100, "셋째", stt_session_id="attempt-3"))
    _windows(
        accumulator,
        _delta(
            1,
            100,
            "다른 세션",
            session_id=OTHER_SESSION_ID,
            event_id="other-session-delta",
        ),
    )

    metrics = accumulator.metrics_snapshot()
    assert metrics["tracked_sessions"] == 1
    assert metrics["tracked_event_ids"] == 2
    assert metrics["session_evicted_total"] == 1
    assert metrics["event_dedupe_evicted_total"] == 2
    assert metrics["retired_attempt_evicted_total"] == 1


def test_completion_without_buffer_emits_no_window() -> None:
    accumulator = LectureNoteWindowAccumulator()

    assert _windows(accumulator, _completed(0, 0)) == ()
    assert _windows(accumulator, _completed(0, 0, event_id="other-completion")) == ()
    assert accumulator.metrics_snapshot()["completed_total"] == 1
    assert accumulator.metrics_snapshot()["duplicate_completion_total"] == 1
