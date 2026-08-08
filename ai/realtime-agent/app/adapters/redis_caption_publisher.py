from __future__ import annotations

import asyncio
import math
from typing import Protocol

from app.captions.models import (
    CaptionDelta,
    CaptionSegmentFinal,
    CaptionStreamCompleted,
    CaptionStreamStarted,
)
from app.contracts.serialization import utc_rfc3339

CAPTION_STREAM_KEY = "ai:captions:live"
CAPTION_STREAM_MAXLEN = 10_000


class RedisStreamClient(Protocol):
    async def xadd(
        self,
        name: str,
        fields: dict[str, str],
        *,
        maxlen: int,
        approximate: bool,
    ) -> object: ...


def to_stream_fields(
    event: CaptionStreamStarted | CaptionDelta | CaptionSegmentFinal | CaptionStreamCompleted,
) -> dict[str, str]:
    common = {
        "contractVersion": event.contract_version,
        "eventId": event.event_id,
        "type": event.type,
        "sessionId": str(event.session_id),
        "lessonId": str(event.lesson_id),
    }
    if isinstance(event, CaptionStreamStarted):
        return {
            **common,
            "sttSessionId": event.stt_session_id,
            "audioStartedAt": utc_rfc3339(event.audio_started_at),
            "occurredAt": utc_rfc3339(event.occurred_at),
        }
    if isinstance(event, CaptionDelta):
        return {
            **common,
            "sttSessionId": event.stt_session_id,
            "sequence": str(event.sequence),
            "streamElapsedMs": str(event.stream_elapsed_ms),
            "text": event.text,
            "occurredAt": utc_rfc3339(event.occurred_at),
        }
    if isinstance(event, CaptionSegmentFinal):
        return {
            **common,
            "sttSessionId": event.stt_session_id,
            "segmentIndex": str(event.segment_index),
            "lastSequence": str(event.last_sequence),
            "text": event.text,
            "startStreamElapsedMs": str(event.start_stream_elapsed_ms),
            "endStreamElapsedMs": str(event.end_stream_elapsed_ms),
            # 값이 없으면 키를 아예 넣지 않는다 — 빈 문자열을 보내면 소비자가 "0"과 구분하지 못한다.
            **({"startedAt": utc_rfc3339(event.started_at)} if event.started_at else {}),
            **({"endedAt": utc_rfc3339(event.ended_at)} if event.ended_at else {}),
            "boundaryReason": event.boundary_reason,
            "occurredAt": utc_rfc3339(event.occurred_at),
        }
    return {
        **common,
        "sttSessionId": event.stt_session_id,
        "lastSequence": str(event.last_sequence),
        "streamElapsedMs": str(event.stream_elapsed_ms),
        "reason": event.reason,
        "occurredAt": utc_rfc3339(event.occurred_at),
    }


class RedisCaptionPublisher:
    def __init__(
        self,
        client: RedisStreamClient,
        stream_key: str = CAPTION_STREAM_KEY,
        *,
        stream_maxlen: int = CAPTION_STREAM_MAXLEN,
        publish_timeout_seconds: float = 1.25,
    ) -> None:
        if not stream_key:
            raise ValueError("stream_key must not be empty")
        if isinstance(stream_maxlen, bool) or not isinstance(stream_maxlen, int):
            raise TypeError("stream_maxlen must be an integer")
        if stream_maxlen <= 0:
            raise ValueError("stream_maxlen must be positive")
        if (
            isinstance(publish_timeout_seconds, bool)
            or not isinstance(publish_timeout_seconds, int | float)
            or not math.isfinite(publish_timeout_seconds)
        ):
            raise TypeError("publish_timeout_seconds must be a finite number")
        if publish_timeout_seconds <= 0:
            raise ValueError("publish_timeout_seconds must be positive")
        self._client = client
        self._stream_key = stream_key
        self._stream_maxlen = stream_maxlen
        self._publish_timeout_seconds = float(publish_timeout_seconds)

    async def publish_started(self, event: CaptionStreamStarted) -> None:
        await self._publish(event)

    async def publish_delta(self, event: CaptionDelta) -> None:
        await self._publish(event)

    async def publish_segment_final(self, event: CaptionSegmentFinal) -> None:
        await self._publish(event)

    async def publish_completed(self, event: CaptionStreamCompleted) -> None:
        await self._publish(event)

    async def _publish(
        self,
        event: CaptionStreamStarted | CaptionDelta | CaptionSegmentFinal | CaptionStreamCompleted,
    ) -> None:
        async with asyncio.timeout(self._publish_timeout_seconds):
            await self._client.xadd(
                self._stream_key,
                to_stream_fields(event),
                maxlen=self._stream_maxlen,
                approximate=True,
            )
