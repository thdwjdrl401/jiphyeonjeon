from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID, uuid4

from app.captions.models import CaptionDelta, CaptionStreamCompleted
from app.stt.engine import EngineCompleted, EngineWarning, TextDelta


class CaptionPublisher(Protocol):
    async def publish_delta(self, event: CaptionDelta) -> None: ...

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
        self._completed = False

    @property
    def sequence(self) -> int:
        return self._sequence

    @property
    def last_stream_elapsed_ms(self) -> int:
        return self._last_stream_elapsed_ms

    async def __call__(self, event: TextDelta | EngineWarning) -> None:
        if isinstance(event, EngineWarning):
            return
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
