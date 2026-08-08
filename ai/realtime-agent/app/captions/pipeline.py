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
from app.captions.text_normalizer import CaptionTextNormalizer
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
        text_normalizer: CaptionTextNormalizer | None = None,
    ) -> None:
        self._publisher = publisher
        self._session_id = session_id
        self._lesson_id = lesson_id
        self._stt_session_id = stt_session_id
        self._event_id_factory = event_id_factory or (lambda: str(uuid4()))
        self._clock = clock or (lambda: datetime.now(UTC))
        self._text_normalizer = text_normalizer or CaptionTextNormalizer()
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

    async def publish_delta(self, event: TextDelta) -> CaptionDelta | None:
        if self._completed:
            raise RuntimeError("caption stream is already completed")
        if event.stream_elapsed_ms < self._last_stream_elapsed_ms:
            raise ValueError("caption stream_elapsed_ms must not regress")
        text = self._text_normalizer.normalize_delta(event.text)
        if not text:
            self._last_stream_elapsed_ms = event.stream_elapsed_ms
            return None
        return await self._publish_normalized_delta(text, event.stream_elapsed_ms)

    async def _publish_normalized_delta(
        self,
        text: str,
        stream_elapsed_ms: int,
    ) -> CaptionDelta:
        caption = CaptionDelta(
            event_id=self._event_id_factory(),
            session_id=self._session_id,
            lesson_id=self._lesson_id,
            stt_session_id=self._stt_session_id,
            sequence=self._sequence + 1,
            stream_elapsed_ms=stream_elapsed_ms,
            text=text,
            occurred_at=self._clock(),
        )
        await self._publisher.publish_delta(caption)
        self._sequence = caption.sequence
        self._last_stream_elapsed_ms = stream_elapsed_ms
        return caption

    async def publish_segment_final(self, event: SegmentFinal) -> CaptionSegmentFinal | None:
        if self._completed:
            raise RuntimeError("caption stream is already completed")
        if event.end_stream_elapsed_ms < self._last_stream_elapsed_ms:
            raise ValueError("caption stream_elapsed_ms must not regress")
        text = self._text_normalizer.normalize_final(event.text)
        if not text:
            text = self._text_normalizer.current_text.strip()
        if not text:
            self._last_stream_elapsed_ms = event.end_stream_elapsed_ms
            self._text_normalizer.reset_segment()
            return None
        # A final normally closes deltas that are already out. When it does not, the
        # text has to go out as a delta first so delta consumers see it and the
        # segment can point at a sequence. An engine that split one segment into
        # several finals already delivered every sentence as a delta, so re-sending
        # here would duplicate the text for those consumers.
        closes_pending_deltas = self._sequence > self._last_final_sequence
        already_delivered = event.text_already_delivered and self._sequence > 0
        if not closes_pending_deltas and not already_delivered:
            await self._publish_normalized_delta(text, event.end_stream_elapsed_ms)
        segment = CaptionSegmentFinal(
            event_id=self._event_id_factory(),
            session_id=self._session_id,
            lesson_id=self._lesson_id,
            stt_session_id=self._stt_session_id,
            segment_index=self._segment_index,
            last_sequence=self._sequence,
            text=text,
            start_stream_elapsed_ms=event.start_stream_elapsed_ms,
            end_stream_elapsed_ms=event.end_stream_elapsed_ms,
            boundary_reason=event.boundary_reason,
            occurred_at=self._clock(),
            # 엔진이 실어 준 벽시계를 그대로 옮긴다. 여기서 다시 계산하지 않는다 —
            # 발화 시각을 아는 것은 오디오를 받은 쪽뿐이다.
            started_at=event.started_at,
            ended_at=event.ended_at,
        )
        await self._publisher.publish_segment_final(segment)
        self._segment_index += 1
        self._last_final_sequence = self._sequence
        self._last_stream_elapsed_ms = event.end_stream_elapsed_ms
        self._text_normalizer.reset_segment()
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
