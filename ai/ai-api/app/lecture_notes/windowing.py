from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass, field, fields

from app.captions import CaptionCompleted, CaptionDelta, CaptionEntry
from app.lecture_notes.models import LectureNoteWindow, WindowFlushReason
from app.lecture_notes.recovery import (
    AttemptBufferCheckpoint,
    WindowAccumulatorCheckpoint,
)

_STRONG_ENDINGS = (".", "?", "!", "。", "？", "！", "\n")
_SENTENCE_PATTERN = re.compile(r"[^.!?。？！\n]+(?:[.!?。？！]+|\n|$)")


@dataclass(slots=True)
class WindowMetrics:
    delta_appended_total: int = 0
    windows_emitted_total: int = 0
    duplicate_event_total: int = 0
    duplicate_sequence_total: int = 0
    sequence_gap_total: int = 0
    sequence_missing_total: int = 0
    stream_regression_total: int = 0
    attempt_changed_total: int = 0
    stale_attempt_total: int = 0
    completed_total: int = 0
    duplicate_completion_total: int = 0
    after_completion_total: int = 0
    event_dedupe_evicted_total: int = 0
    retired_attempt_evicted_total: int = 0
    session_evicted_total: int = 0
    session_released_total: int = 0
    completed_tombstone_evicted_total: int = 0


@dataclass(slots=True)
class _AttemptBuffer:
    stt_session_id: str
    last_sequence: int = 0
    last_stream_elapsed_ms: int = 0
    window_started_at_ms: int = 0
    window_start_sequence: int | None = None
    text_parts: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "".join(self.text_parts)


@dataclass(slots=True)
class _SessionBuffer:
    lesson_id: str
    current: _AttemptBuffer
    retired_attempts: OrderedDict[str, None] = field(default_factory=OrderedDict)
    previous_context: str = ""
    completed: bool = False


@dataclass(frozen=True, slots=True)
class WindowIngestResult:
    """한 entry가 만든 window와 실제로 수락된 completion을 함께 반환한다."""

    windows: tuple[LectureNoteWindow, ...] = ()
    completion: CaptionCompleted | None = None


class LectureNoteWindowAccumulator:
    """자막 entry를 I/O 없이 크기가 제한된 모델 입력 window로 접는다."""

    def __init__(
        self,
        *,
        min_window_ms: int = 15_000,
        target_window_ms: int = 25_000,
        max_window_ms: int = 40_000,
        min_chars: int = 80,
        max_chars: int = 400,
        max_sessions: int = 1_000,
        max_event_ids: int = 10_000,
        max_retired_attempts_per_session: int = 16,
    ) -> None:
        if (
            min(
                min_window_ms,
                target_window_ms,
                max_window_ms,
                min_chars,
                max_chars,
                max_sessions,
                max_event_ids,
                max_retired_attempts_per_session,
            )
            <= 0
        ):
            raise ValueError("lecture note window bounds must be positive")
        if not min_window_ms <= target_window_ms <= max_window_ms:
            raise ValueError("lecture note time bounds must be ordered")
        if min_chars > max_chars:
            raise ValueError("lecture note character bounds must be ordered")
        self._min_window_ms = min_window_ms
        self._target_window_ms = target_window_ms
        self._max_window_ms = max_window_ms
        self._min_chars = min_chars
        self._max_chars = max_chars
        self._max_sessions = max_sessions
        self._max_event_ids = max_event_ids
        self._max_retired_attempts = max_retired_attempts_per_session
        self._sessions: OrderedDict[str, _SessionBuffer] = OrderedDict()
        self._completed_sessions: OrderedDict[str, None] = OrderedDict()
        self._seen_event_ids: OrderedDict[str, str] = OrderedDict()
        self._metrics = WindowMetrics()

    def ingest(self, entry: CaptionEntry) -> WindowIngestResult:
        if entry.eventId in self._seen_event_ids:
            self._seen_event_ids.move_to_end(entry.eventId)
            self._metrics.duplicate_event_total += 1
            return WindowIngestResult()
        self._remember_event(entry.eventId, entry.sessionId)

        if entry.sessionId in self._completed_sessions:
            self._completed_sessions.move_to_end(entry.sessionId)
            if isinstance(entry, CaptionCompleted):
                self._metrics.duplicate_completion_total += 1
            else:
                self._metrics.after_completion_total += 1
            return WindowIngestResult()

        session = self._sessions.get(entry.sessionId)
        if session is None:
            session = _SessionBuffer(
                lesson_id=entry.lessonId,
                current=_AttemptBuffer(stt_session_id=entry.sttSessionId),
            )
            self._sessions[entry.sessionId] = session
            if len(self._sessions) > self._max_sessions:
                self._sessions.popitem(last=False)
                self._metrics.session_evicted_total += 1
        elif session.lesson_id != entry.lessonId:
            raise ValueError("caption session cannot change lesson scope")
        else:
            self._sessions.move_to_end(entry.sessionId)

        if session.completed:
            if (
                isinstance(entry, CaptionCompleted)
                and entry.sttSessionId == session.current.stt_session_id
            ):
                self._metrics.duplicate_completion_total += 1
            else:
                self._metrics.after_completion_total += 1
            return WindowIngestResult()

        windows: list[LectureNoteWindow] = []
        if entry.sttSessionId != session.current.stt_session_id:
            if entry.sttSessionId in session.retired_attempts:
                self._metrics.stale_attempt_total += 1
                return WindowIngestResult()
            # attempt가 바뀌면 짧은 text도 버리지 않고 이전 window로 먼저 내보낸다.
            previous = self._flush(
                entry.sessionId,
                session,
                WindowFlushReason.ATTEMPT_CHANGED,
            )
            if previous is not None:
                windows.append(previous)
            self._remember_retired_attempt(session, session.current.stt_session_id)
            session.current = _AttemptBuffer(stt_session_id=entry.sttSessionId)
            self._metrics.attempt_changed_total += 1

        if isinstance(entry, CaptionDelta):
            emitted = self._ingest_delta(entry, session)
            if emitted is not None:
                windows.append(emitted)
        else:
            emitted = self._ingest_completed(entry, session)
            if emitted is not None:
                windows.append(emitted)
        return WindowIngestResult(
            windows=tuple(windows),
            completion=entry if isinstance(entry, CaptionCompleted) else None,
        )

    def metrics_snapshot(self) -> dict[str, int]:
        snapshot = {
            metric_field.name: int(getattr(self._metrics, metric_field.name))
            for metric_field in fields(self._metrics)
        }
        snapshot.update(
            tracked_sessions=len(self._sessions),
            completed_session_tombstones=len(self._completed_sessions),
            tracked_event_ids=len(self._seen_event_ids),
            active_sessions=sum(not session.completed for session in self._sessions.values()),
        )
        return snapshot

    def is_completed(self, session_id: str) -> bool:
        session = self._sessions.get(session_id)
        return bool(
            (session is not None and session.completed)
            or session_id in self._completed_sessions
        )

    def remove_session(self, session_id: str) -> None:
        """전체 완료 상태를 해제하고 bounded tombstone만 유지한다."""

        session = self._sessions.get(session_id)
        if session is not None and not session.completed:
            raise ValueError("active lecture note session cannot be removed")
        self._sessions.pop(session_id, None)
        self._completed_sessions[session_id] = None
        self._completed_sessions.move_to_end(session_id)
        self._metrics.session_released_total += 1
        while len(self._completed_sessions) > self._max_sessions:
            self._completed_sessions.popitem(last=False)
            self._metrics.completed_tombstone_evicted_total += 1

    def export_session(self, session_id: str) -> WindowAccumulatorCheckpoint | None:
        """재시작에 필요한 한 세션의 자막 누적 상태만 복사한다."""
        session = self._sessions.get(session_id)
        if session is None:
            return None
        attempt = session.current
        return WindowAccumulatorCheckpoint(
            sessionId=session_id,
            lessonId=session.lesson_id,
            current=AttemptBufferCheckpoint(
                sttSessionId=attempt.stt_session_id,
                lastSequence=attempt.last_sequence,
                lastStreamElapsedMs=attempt.last_stream_elapsed_ms,
                windowStartedAtMs=attempt.window_started_at_ms,
                windowStartSequence=attempt.window_start_sequence,
                partialText=attempt.text,
            ),
            retiredAttempts=tuple(session.retired_attempts),
            previousContext=session.previous_context,
            completed=session.completed,
            seenEventIds=tuple(
                event_id
                for event_id, owner_session_id in self._seen_event_ids.items()
                if owner_session_id == session_id
            ),
        )

    def restore_session(self, checkpoint: WindowAccumulatorCheckpoint) -> None:
        """검증된 checkpoint로 한 세션을 덮어써 replay 중복 경계를 복원한다."""
        self._completed_sessions.pop(checkpoint.sessionId, None)
        attempt = checkpoint.current
        self._sessions[checkpoint.sessionId] = _SessionBuffer(
            lesson_id=checkpoint.lessonId,
            current=_AttemptBuffer(
                stt_session_id=attempt.sttSessionId,
                last_sequence=attempt.lastSequence,
                last_stream_elapsed_ms=attempt.lastStreamElapsedMs,
                window_started_at_ms=attempt.windowStartedAtMs,
                window_start_sequence=attempt.windowStartSequence,
                text_parts=[attempt.partialText] if attempt.partialText else [],
            ),
            retired_attempts=OrderedDict.fromkeys(checkpoint.retiredAttempts),
            previous_context=checkpoint.previousContext,
            completed=checkpoint.completed,
        )
        self._sessions.move_to_end(checkpoint.sessionId)
        while len(self._sessions) > self._max_sessions:
            self._sessions.popitem(last=False)

        stale_event_ids = [
            event_id
            for event_id, owner_session_id in self._seen_event_ids.items()
            if owner_session_id == checkpoint.sessionId
        ]
        for event_id in stale_event_ids:
            self._seen_event_ids.pop(event_id, None)
        for event_id in checkpoint.seenEventIds:
            self._remember_event(event_id, checkpoint.sessionId)

    def _ingest_delta(
        self,
        entry: CaptionDelta,
        session: _SessionBuffer,
    ) -> LectureNoteWindow | None:
        attempt = session.current
        sequence = int(entry.sequence)
        stream_elapsed_ms = int(entry.streamElapsedMs)
        if sequence <= attempt.last_sequence:
            self._metrics.duplicate_sequence_total += 1
            return None
        if stream_elapsed_ms < attempt.last_stream_elapsed_ms:
            self._metrics.stream_regression_total += 1
            return None
        if sequence > attempt.last_sequence + 1:
            self._metrics.sequence_gap_total += 1
            self._metrics.sequence_missing_total += sequence - attempt.last_sequence - 1

        if attempt.window_start_sequence is None:
            attempt.window_start_sequence = sequence
        attempt.last_sequence = sequence
        attempt.last_stream_elapsed_ms = stream_elapsed_ms
        attempt.text_parts.append(entry.text)
        self._metrics.delta_appended_total += 1

        reason = self._flush_reason(attempt)
        if reason is None:
            return None
        return self._flush(entry.sessionId, session, reason)

    def _ingest_completed(
        self,
        entry: CaptionCompleted,
        session: _SessionBuffer,
    ) -> LectureNoteWindow | None:
        attempt = session.current
        last_sequence = int(entry.lastSequence)
        if last_sequence > attempt.last_sequence:
            self._metrics.sequence_gap_total += 1
            self._metrics.sequence_missing_total += last_sequence - attempt.last_sequence
        attempt.last_stream_elapsed_ms = max(
            attempt.last_stream_elapsed_ms,
            int(entry.streamElapsedMs),
        )
        emitted = self._flush(entry.sessionId, session, WindowFlushReason.COMPLETED)
        session.completed = True
        self._metrics.completed_total += 1
        return emitted

    def _flush_reason(self, attempt: _AttemptBuffer) -> WindowFlushReason | None:
        text = attempt.text
        elapsed_ms = attempt.last_stream_elapsed_ms - attempt.window_started_at_ms
        # 강제 임계값은 최소 조건보다 우선하고, 그 뒤 목표 시간과 문장 경계를 차례로 본다.
        if elapsed_ms >= self._max_window_ms or len(text) >= self._max_chars:
            return WindowFlushReason.FORCED_THRESHOLD
        if elapsed_ms < self._min_window_ms or len(text) < self._min_chars:
            return None
        if elapsed_ms >= self._target_window_ms:
            return WindowFlushReason.TARGET_REACHED
        if _has_strong_ending(text):
            return WindowFlushReason.STRONG_BOUNDARY
        return None

    def _flush(
        self,
        session_id: str,
        session: _SessionBuffer,
        reason: WindowFlushReason,
    ) -> LectureNoteWindow | None:
        attempt = session.current
        text = attempt.text
        if not text or attempt.window_start_sequence is None:
            return None
        window = LectureNoteWindow(
            session_id=session_id,
            lesson_id=session.lesson_id,
            stt_session_id=attempt.stt_session_id,
            start_sequence=attempt.window_start_sequence,
            end_sequence=attempt.last_sequence,
            start_stream_elapsed_ms=attempt.window_started_at_ms,
            end_stream_elapsed_ms=attempt.last_stream_elapsed_ms,
            text=text,
            previous_context=session.previous_context,
            flush_reason=reason,
        )
        session.previous_context = _trailing_sentences(text)
        attempt.window_started_at_ms = attempt.last_stream_elapsed_ms
        attempt.window_start_sequence = None
        attempt.text_parts.clear()
        self._metrics.windows_emitted_total += 1
        return window

    def _remember_event(self, event_id: str, session_id: str) -> None:
        self._seen_event_ids[event_id] = session_id
        if len(self._seen_event_ids) > self._max_event_ids:
            self._seen_event_ids.popitem(last=False)
            self._metrics.event_dedupe_evicted_total += 1

    def _remember_retired_attempt(
        self,
        session: _SessionBuffer,
        stt_session_id: str,
    ) -> None:
        session.retired_attempts[stt_session_id] = None
        if len(session.retired_attempts) > self._max_retired_attempts:
            session.retired_attempts.popitem(last=False)
            self._metrics.retired_attempt_evicted_total += 1


def _has_strong_ending(text: str) -> bool:
    return text.rstrip(" \t\r").endswith(_STRONG_ENDINGS)


def _trailing_sentences(text: str, limit: int = 2) -> str:
    sentences = [match.group(0).strip() for match in _SENTENCE_PATTERN.finditer(text)]
    return " ".join(sentence for sentence in sentences[-limit:] if sentence)
