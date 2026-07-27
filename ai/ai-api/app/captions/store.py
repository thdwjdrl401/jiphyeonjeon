from __future__ import annotations

from collections import OrderedDict, deque
from dataclasses import dataclass, field, fields
from datetime import datetime
from enum import StrEnum
from hashlib import blake2b
from uuid import UUID, uuid4

from app.captions.models import CaptionCompleted, CaptionDelta, CaptionEntry


class IngestOutcome(StrEnum):
    APPENDED = "appended"
    COMPLETED = "completed"
    DUPLICATE_EVENT = "duplicate_event"
    DUPLICATE_SEQUENCE = "duplicate_sequence"
    DUPLICATE_COMPLETION = "duplicate_completion"
    CONFLICT = "conflict"
    AFTER_COMPLETION = "after_completion"
    STREAM_REGRESSION = "stream_regression"
    STALE_ATTEMPT = "stale_attempt"


@dataclass(frozen=True, slots=True)
class CaptionContextItem:
    event_id: str
    sequence: int
    stream_elapsed_ms: int
    text: str


@dataclass(frozen=True, slots=True)
class CaptionContextResult:
    session_id: str
    lesson_id: UUID | None
    stt_session_id: str | None
    generation_id: str
    known_session: bool
    items: tuple[CaptionContextItem, ...]
    text: str
    completed: bool
    incomplete: bool
    truncated: bool
    available: bool
    first_stream_elapsed_ms: int | None
    last_stream_elapsed_ms: int | None


@dataclass(slots=True)
class CaptionContextMetrics:
    delta_appended_total: int = 0
    completed_total: int = 0
    duplicate_event_total: int = 0
    duplicate_sequence_total: int = 0
    duplicate_completion_total: int = 0
    conflict_total: int = 0
    after_completion_total: int = 0
    stale_attempt_total: int = 0
    attempt_replaced_total: int = 0
    attempt_replaced_incomplete_total: int = 0
    sequence_gap_total: int = 0
    sequence_missing_total: int = 0
    stream_regression_total: int = 0
    context_evictions_events_total: int = 0
    context_evictions_bytes_total: int = 0
    context_evictions_bytes_events_total: int = 0
    context_evictions_sessions_total: int = 0
    context_evictions_session_events_total: int = 0
    context_evictions_session_bytes_total: int = 0
    context_evictions_attempt_events_total: int = 0
    context_evictions_attempt_bytes_total: int = 0


@dataclass(slots=True)
class _AttemptContext:
    stt_session_id: str
    first_occurred_at: datetime
    items: deque[CaptionContextItem] = field(default_factory=deque)
    item_bytes: int = 0
    last_sequence: int = 0
    last_stream_elapsed_ms: int = 0
    incomplete: bool = False
    truncated: bool = False
    completed: bool = False
    completion_fingerprint: bytes | None = None
    sequence_fingerprints: OrderedDict[int, bytes] = field(default_factory=OrderedDict)


@dataclass(slots=True)
class _SessionContext:
    lesson_id: UUID
    current: _AttemptContext
    retired_attempts: OrderedDict[str, None] = field(default_factory=OrderedDict)


class CaptionContextStore:
    """Bounded latest-attempt view of append-only realtime caption entries."""

    def __init__(
        self,
        *,
        lookback_ms: int = 300_000,
        max_events_per_session: int = 1_000,
        max_bytes_per_session: int = 1_048_576,
        max_sessions: int = 1_000,
        max_retired_attempts_per_session: int = 16,
    ) -> None:
        if (
            min(
                lookback_ms,
                max_events_per_session,
                max_bytes_per_session,
                max_sessions,
                max_retired_attempts_per_session,
            )
            <= 0
        ):
            raise ValueError("caption context bounds must be positive")
        self._lookback_ms = lookback_ms
        self._max_events = max_events_per_session
        self._max_bytes = max_bytes_per_session
        self._max_sessions = max_sessions
        self._max_retired_attempts = max_retired_attempts_per_session
        self._generation_id = uuid4().hex
        self._sessions: OrderedDict[str, _SessionContext] = OrderedDict()
        self._event_fingerprints: OrderedDict[str, bytes] = OrderedDict()
        self._event_dedupe_limit = min(max_events_per_session * max_sessions, 100_000)
        self._metrics = CaptionContextMetrics()

    def ingest(self, entry: CaptionEntry) -> IngestOutcome:
        fingerprint = _fingerprint(entry)
        existing_event = self._event_fingerprints.get(entry.eventId)
        if existing_event is not None:
            if existing_event == fingerprint:
                self._metrics.duplicate_event_total += 1
                return IngestOutcome.DUPLICATE_EVENT
            self._mark_incomplete(entry.sessionId)
            self._metrics.conflict_total += 1
            return IngestOutcome.CONFLICT

        lesson_id = UUID(entry.lessonId)
        session = self._sessions.get(entry.sessionId)
        if session is None:
            session = self._new_session(
                entry.sessionId,
                lesson_id,
                entry.sttSessionId,
                entry.occurredAt,
            )
        else:
            self._sessions.move_to_end(entry.sessionId)
            if session.lesson_id != lesson_id:
                session.current.incomplete = True
                self._metrics.conflict_total += 1
                self._remember_event(entry.eventId, fingerprint)
                return IngestOutcome.CONFLICT

        attempt = self._select_attempt(session, entry.sttSessionId, entry.occurredAt)
        if attempt is None:
            self._metrics.stale_attempt_total += 1
            self._remember_event(entry.eventId, fingerprint)
            return IngestOutcome.STALE_ATTEMPT

        if isinstance(entry, CaptionDelta):
            outcome = self._ingest_delta(attempt, entry, fingerprint)
        else:
            outcome = self._ingest_completed(attempt, entry, fingerprint)
        self._remember_event(entry.eventId, fingerprint)
        return outcome

    def query(
        self,
        session_id: str,
        context_time_ms: int,
        *,
        lookback_ms: int | None = None,
    ) -> CaptionContextResult:
        if context_time_ms < 0:
            raise ValueError("context_time_ms must be non-negative")
        window = self._lookback_ms if lookback_ms is None else lookback_ms
        if window <= 0:
            raise ValueError("lookback_ms must be positive")
        session = self._sessions.get(session_id)
        if session is None:
            return CaptionContextResult(
                session_id=session_id,
                lesson_id=None,
                stt_session_id=None,
                generation_id=self._generation_id,
                known_session=False,
                items=(),
                text="",
                completed=False,
                incomplete=False,
                truncated=False,
                available=False,
                first_stream_elapsed_ms=None,
                last_stream_elapsed_ms=None,
            )
        self._sessions.move_to_end(session_id)
        attempt = session.current
        lower_bound = max(0, context_time_ms - window)
        items = tuple(
            item
            for item in attempt.items
            if lower_bound <= item.stream_elapsed_ms <= context_time_ms
        )
        return CaptionContextResult(
            session_id=session_id,
            lesson_id=session.lesson_id,
            stt_session_id=attempt.stt_session_id,
            generation_id=self._generation_id,
            known_session=True,
            items=items,
            text="".join(item.text for item in items),
            completed=attempt.completed,
            incomplete=attempt.incomplete,
            truncated=attempt.truncated,
            available=bool(items),
            first_stream_elapsed_ms=items[0].stream_elapsed_ms if items else None,
            last_stream_elapsed_ms=items[-1].stream_elapsed_ms if items else None,
        )

    def metrics_snapshot(self) -> dict[str, int]:
        sequence_dedupe_entries = sum(
            len(session.current.sequence_fingerprints) for session in self._sessions.values()
        )
        snapshot = {
            metric_field.name: int(getattr(self._metrics, metric_field.name))
            for metric_field in fields(self._metrics)
        }
        snapshot.update(
            tracked_sessions=len(self._sessions),
            active_sessions=sum(
                not session.current.completed for session in self._sessions.values()
            ),
            completed_sessions=sum(
                session.current.completed for session in self._sessions.values()
            ),
            context_events=sum(len(session.current.items) for session in self._sessions.values()),
            context_bytes=sum(session.current.item_bytes for session in self._sessions.values()),
            event_dedupe_entries=len(self._event_fingerprints),
            sequence_dedupe_entries=sequence_dedupe_entries,
            retired_attempt_entries=sum(
                len(session.retired_attempts) for session in self._sessions.values()
            ),
            incomplete_sessions=sum(
                session.current.incomplete for session in self._sessions.values()
            ),
            truncated_sessions=sum(
                session.current.truncated for session in self._sessions.values()
            ),
        )
        return snapshot

    def _new_session(
        self,
        session_id: str,
        lesson_id: UUID,
        stt_session_id: str,
        occurred_at: datetime,
    ) -> _SessionContext:
        session = _SessionContext(
            lesson_id=lesson_id,
            current=_AttemptContext(
                stt_session_id=stt_session_id,
                first_occurred_at=occurred_at,
            ),
        )
        self._sessions[session_id] = session
        while len(self._sessions) > self._max_sessions:
            _, evicted = self._sessions.popitem(last=False)
            self._metrics.context_evictions_sessions_total += 1
            self._metrics.context_evictions_session_events_total += len(evicted.current.items)
            self._metrics.context_evictions_session_bytes_total += evicted.current.item_bytes
        return session

    def _select_attempt(
        self,
        session: _SessionContext,
        stt_session_id: str,
        occurred_at: datetime,
    ) -> _AttemptContext | None:
        current = session.current
        if current.stt_session_id == stt_session_id:
            return current
        if stt_session_id in session.retired_attempts:
            return None
        if occurred_at <= current.first_occurred_at:
            return None

        session.retired_attempts[current.stt_session_id] = None
        while len(session.retired_attempts) > self._max_retired_attempts:
            session.retired_attempts.popitem(last=False)
        self._metrics.attempt_replaced_total += 1
        self._metrics.context_evictions_attempt_events_total += len(current.items)
        self._metrics.context_evictions_attempt_bytes_total += current.item_bytes
        replacement_incomplete = not current.completed
        if replacement_incomplete:
            self._metrics.attempt_replaced_incomplete_total += 1
        session.current = _AttemptContext(
            stt_session_id=stt_session_id,
            first_occurred_at=occurred_at,
            incomplete=replacement_incomplete,
        )
        return session.current

    def _ingest_delta(
        self,
        context: _AttemptContext,
        entry: CaptionDelta,
        fingerprint: bytes,
    ) -> IngestOutcome:
        sequence = int(entry.sequence)
        stream_elapsed_ms = int(entry.streamElapsedMs)
        if context.completed:
            context.incomplete = True
            self._metrics.after_completion_total += 1
            return IngestOutcome.AFTER_COMPLETION

        known_sequence = context.sequence_fingerprints.get(sequence)
        if sequence <= context.last_sequence:
            if known_sequence == fingerprint:
                self._metrics.duplicate_sequence_total += 1
                return IngestOutcome.DUPLICATE_SEQUENCE
            context.incomplete = True
            self._metrics.conflict_total += 1
            return IngestOutcome.CONFLICT

        if sequence > context.last_sequence + 1:
            context.incomplete = True
            self._metrics.sequence_gap_total += 1
            self._metrics.sequence_missing_total += sequence - context.last_sequence - 1

        if context.last_sequence > 0 and stream_elapsed_ms < context.last_stream_elapsed_ms:
            context.incomplete = True
            self._metrics.stream_regression_total += 1
            return IngestOutcome.STREAM_REGRESSION

        context.last_sequence = sequence
        self._remember_sequence(context, sequence, fingerprint)
        item = CaptionContextItem(
            event_id=entry.eventId,
            sequence=sequence,
            stream_elapsed_ms=stream_elapsed_ms,
            text=entry.text,
        )
        context.items.append(item)
        context.item_bytes += len(entry.text.encode("utf-8"))
        context.last_stream_elapsed_ms = stream_elapsed_ms
        self._metrics.delta_appended_total += 1
        self._enforce_attempt_bounds(context)
        return IngestOutcome.APPENDED

    def _ingest_completed(
        self,
        context: _AttemptContext,
        entry: CaptionCompleted,
        fingerprint: bytes,
    ) -> IngestOutcome:
        if context.completed:
            if context.completion_fingerprint == fingerprint:
                self._metrics.duplicate_completion_total += 1
                return IngestOutcome.DUPLICATE_COMPLETION
            context.incomplete = True
            self._metrics.conflict_total += 1
            return IngestOutcome.CONFLICT

        last_sequence = int(entry.lastSequence)
        if last_sequence > context.last_sequence:
            context.incomplete = True
            self._metrics.sequence_gap_total += 1
            self._metrics.sequence_missing_total += last_sequence - context.last_sequence
        elif last_sequence < context.last_sequence:
            context.incomplete = True
            self._metrics.conflict_total += 1
        if (
            context.last_sequence > 0
            and int(entry.streamElapsedMs) < context.last_stream_elapsed_ms
        ):
            context.incomplete = True
            self._metrics.stream_regression_total += 1
        context.completed = True
        context.completion_fingerprint = fingerprint
        self._metrics.completed_total += 1
        return IngestOutcome.COMPLETED

    def _mark_incomplete(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is not None:
            session.current.incomplete = True

    def _remember_event(self, event_id: str, fingerprint: bytes) -> None:
        self._event_fingerprints[event_id] = fingerprint
        self._event_fingerprints.move_to_end(event_id)
        while len(self._event_fingerprints) > self._event_dedupe_limit:
            self._event_fingerprints.popitem(last=False)

    def _remember_sequence(
        self,
        context: _AttemptContext,
        sequence: int,
        fingerprint: bytes,
    ) -> None:
        context.sequence_fingerprints[sequence] = fingerprint
        while len(context.sequence_fingerprints) > self._max_events:
            context.sequence_fingerprints.popitem(last=False)

    def _enforce_attempt_bounds(self, context: _AttemptContext) -> None:
        while len(context.items) > self._max_events:
            self._evict_oldest(context, "events")
        while context.item_bytes > self._max_bytes and context.items:
            self._evict_oldest(context, "bytes")

    def _evict_oldest(self, context: _AttemptContext, reason: str) -> None:
        item = context.items.popleft()
        item_bytes = len(item.text.encode("utf-8"))
        context.item_bytes -= item_bytes
        context.incomplete = True
        context.truncated = True
        if reason == "events":
            self._metrics.context_evictions_events_total += 1
        else:
            self._metrics.context_evictions_bytes_total += item_bytes
            self._metrics.context_evictions_bytes_events_total += 1


def _fingerprint(entry: CaptionEntry) -> bytes:
    common = (
        entry.contractVersion,
        entry.type,
        entry.sessionId,
        entry.lessonId,
        entry.sttSessionId,
        entry.occurredAt.isoformat(),
    )
    if isinstance(entry, CaptionDelta):
        values = (*common, entry.sequence, entry.streamElapsedMs, entry.text)
    else:
        values = (*common, entry.lastSequence, entry.streamElapsedMs, entry.reason)
    digest = blake2b(digest_size=32, person=b"liveclass-cap-v1")
    for value in values:
        encoded = value.encode("utf-8")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
    return digest.digest()
