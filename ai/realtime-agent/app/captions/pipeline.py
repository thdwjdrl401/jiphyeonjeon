from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID, uuid4

from app.captions.models import (
    CaptionDelta,
    CaptionSegmentFinal,
    CaptionStreamCompleted,
    CaptionStreamStarted,
)
from app.stt.engine import EngineCompleted, EngineWarning, SegmentFinal, TextDelta


class CaptionPublisher(Protocol):
    async def publish_started(self, event: CaptionStreamStarted) -> None: ...

    async def publish_delta(self, event: CaptionDelta) -> None: ...

    async def publish_segment_final(self, event: CaptionSegmentFinal) -> None: ...

    async def publish_completed(self, event: CaptionStreamCompleted) -> None: ...


class CaptionEventMapper:
    """Map events from room_job's single STT consumer to append-only captions.

    This object never calls ``engine.events()``. It is an event sink for the one
    consumer owned by ``room_job`` and therefore cannot split an audio/STT stream.
    """

    def __init__(
        self,
        publisher: CaptionPublisher,
        *,
        session_id: UUID,
        lesson_id: UUID,
        stt_session_id: str,
        event_id_factory: Callable[[], str] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._publisher = publisher
        self._session_id = session_id
        self._lesson_id = lesson_id
        self._stt_session_id = stt_session_id
        self._event_id_factory = event_id_factory or (lambda: str(uuid4()))
        self._clock = clock or (lambda: datetime.now(UTC))
        self._sequence = 0
        self._last_stream_elapsed_ms = 0
        self._segment_index = 0
        self._last_final_sequence = 0
        self._started = False
        self._completed = False

    @property
    def sequence(self) -> int:
        return self._sequence

    @property
    def last_stream_elapsed_ms(self) -> int:
        return self._last_stream_elapsed_ms

    async def publish_started(self, audio_started_at: datetime) -> CaptionStreamStarted:
        if self._started:
            raise RuntimeError("caption stream is already started")
        if self._completed:
            raise RuntimeError("caption stream is already completed")
        started = CaptionStreamStarted(
            event_id=self._event_id_factory(),
            session_id=self._session_id,
            lesson_id=self._lesson_id,
            stt_session_id=self._stt_session_id,
            audio_started_at=audio_started_at,
            occurred_at=self._clock(),
        )
        await self._publisher.publish_started(started)
        self._started = True
        return started

    async def __call__(self, event: TextDelta | SegmentFinal | EngineWarning) -> None:
        if isinstance(event, EngineWarning):
            return
        if isinstance(event, SegmentFinal):
            await self.publish_segment_final(event)
        else:
            await self.publish_delta(event)

    async def publish_delta(self, event: TextDelta) -> CaptionDelta:
        if self._completed:
            raise RuntimeError("caption stream is already completed")
        if event.stream_elapsed_ms < self._last_stream_elapsed_ms:
            raise ValueError("caption stream_elapsed_ms must not regress")
        stream_elapsed_ms = event.stream_elapsed_ms
        caption = CaptionDelta(
            event_id=self._event_id_factory(),
            session_id=self._session_id,
            lesson_id=self._lesson_id,
            stt_session_id=self._stt_session_id,
            sequence=self._sequence + 1,
            stream_elapsed_ms=stream_elapsed_ms,
            text=event.text,
            occurred_at=self._clock(),
        )
        await self._publisher.publish_delta(caption)
        self._sequence = caption.sequence
        self._last_stream_elapsed_ms = stream_elapsed_ms
        return caption

    async def publish_segment_final(self, event: SegmentFinal) -> CaptionSegmentFinal:
        if self._completed:
            raise RuntimeError("caption stream is already completed")
        if self._sequence <= self._last_final_sequence:
            raise ValueError("segment final requires at least one new caption delta")
        if event.end_stream_elapsed_ms < self._last_stream_elapsed_ms:
            raise ValueError("caption stream_elapsed_ms must not regress")
        segment = CaptionSegmentFinal(
            event_id=self._event_id_factory(),
            session_id=self._session_id,
            lesson_id=self._lesson_id,
            stt_session_id=self._stt_session_id,
            segment_index=self._segment_index,
            last_sequence=self._sequence,
            text=event.text,
            start_stream_elapsed_ms=event.start_stream_elapsed_ms,
            end_stream_elapsed_ms=event.end_stream_elapsed_ms,
            boundary_reason=event.boundary_reason,
            occurred_at=self._clock(),
        )
        await self._publisher.publish_segment_final(segment)
        self._segment_index += 1
        self._last_final_sequence = self._sequence
        self._last_stream_elapsed_ms = event.end_stream_elapsed_ms
        return segment

    async def publish_completed(
        self,
        event: EngineCompleted,
        *,
        reason: str = "ROOM_DELETED",
    ) -> CaptionStreamCompleted:
        if self._completed:
            raise RuntimeError("caption stream is already completed")
        if event.stream_elapsed_ms < self._last_stream_elapsed_ms:
            raise ValueError("caption stream_elapsed_ms must not regress")
        stream_elapsed_ms = event.stream_elapsed_ms
        completed = CaptionStreamCompleted(
            event_id=self._event_id_factory(),
            session_id=self._session_id,
            lesson_id=self._lesson_id,
            stt_session_id=self._stt_session_id,
            last_sequence=self._sequence,
            stream_elapsed_ms=stream_elapsed_ms,
            reason=reason,
            occurred_at=self._clock(),
        )
        await self._publisher.publish_completed(completed)
        self._last_stream_elapsed_ms = stream_elapsed_ms
        self._completed = True
        return completed
