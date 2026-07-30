from __future__ import annotations

import asyncio
import audioop
import base64
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from app.audio.segmentation import SpeechSegment
from app.stt.engine import SttStreamContext
from app.stt.providers.segmented import (
    ProviderSegmentFinal,
    SegmentedStreamingEngine,
    SpeechSegmenter,
)

_REALTIME_SAMPLE_RATE = 24_000
_REALTIME_TRANSCRIPTION_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
_TRANSCRIPTION_DELTA = "conversation.item.input_audio_transcription.delta"
_TRANSCRIPTION_COMPLETED = "conversation.item.input_audio_transcription.completed"
_TRANSCRIPTION_FAILED = "conversation.item.input_audio_transcription.failed"

WebSocketConnect = Callable[..., Awaitable[Any]]

logger = logging.getLogger(__name__)


async def _default_connect(url: str, **kwargs: object) -> Any:
    import websockets

    return await websockets.connect(url, **kwargs)


class OpenAiRealtimeStreamingEngine(SegmentedStreamingEngine):
    """Send client-VAD segments to one serial OpenAI transcription session."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-realtime-whisper",
        *,
        delay: str = "low",
        url: str | None = None,
        segment_timeout_s: float = 20.0,
        connect: WebSocketConnect = _default_connect,
        segmenter: SpeechSegmenter | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("OPENAI_API_KEY is required for openai-realtime")
        if not model.strip():
            raise ValueError("OpenAI realtime transcription model must not be blank")
        if delay not in {"minimal", "low", "medium", "high", "xhigh"}:
            raise ValueError(f"unsupported OpenAI transcription delay: {delay}")
        if segment_timeout_s <= 0:
            raise ValueError("segment_timeout_s must be positive")

        super().__init__("openai-realtime", segmenter=segmenter)
        self._api_key = api_key
        self._model = model
        self._delay = delay
        self._url = url or _REALTIME_TRANSCRIPTION_URL
        self._segment_timeout_s = segment_timeout_s
        self._connect = connect
        self._ws: Any | None = None

    async def _transcribe(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> AsyncIterator[str | ProviderSegmentFinal]:
        ws = await self._ensure_connected(context.language)
        pcm24, _state = audioop.ratecv(
            segment.pcm,
            2,
            1,
            segment.sample_rate,
            _REALTIME_SAMPLE_RATE,
            None,
        )
        await ws.send(
            json.dumps(
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(pcm24).decode("ascii"),
                }
            )
        )
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

        emitted = ""
        item_id: str | None = None
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=self._segment_timeout_s)
            except TimeoutError as exc:
                raise TimeoutError(
                    f"OpenAI Realtime segment timed out after {self._segment_timeout_s:g}s"
                ) from exc

            event = json.loads(raw)
            event_type = event.get("type")
            if event_type == "error":
                raise RuntimeError(
                    f"OpenAI Realtime transcription error: {event.get('error', event)}"
                )
            if event_type == "input_audio_buffer.committed":
                committed_item_id = event.get("item_id")
                if not isinstance(committed_item_id, str) or not committed_item_id:
                    raise RuntimeError("OpenAI committed event omitted item_id")
                item_id = committed_item_id
                continue
            if event_type not in {
                _TRANSCRIPTION_DELTA,
                _TRANSCRIPTION_COMPLETED,
                _TRANSCRIPTION_FAILED,
            }:
                continue
            if item_id is None or event.get("item_id") != item_id:
                continue

            if event_type == _TRANSCRIPTION_FAILED:
                error = event.get("error")
                detail = error.get("message") if isinstance(error, dict) else error
                raise RuntimeError(
                    f"OpenAI Realtime transcription failed: {detail or 'unknown error'}"
                )

            if event_type == _TRANSCRIPTION_DELTA:
                delta = event.get("delta", "")
                if delta:
                    emitted += delta
                    yield delta
                continue

            transcript = event.get("transcript", "")
            if not emitted:
                if transcript:
                    yield transcript
            elif transcript.startswith(emitted):
                remainder = transcript[len(emitted) :]
                if remainder:
                    yield remainder
            elif transcript.strip() != emitted.strip():
                logger.warning(
                    "OpenAI final transcript revised already emitted realtime deltas; "
                    "publishing provider final as authoritative segment text",
                    extra={
                        "emitted_length": len(emitted),
                        "final_length": len(transcript),
                    },
                )
            yield ProviderSegmentFinal(transcript or emitted)
            return

    async def _ensure_connected(self, language: str) -> Any:
        if self._ws is not None:
            return self._ws
        self._ws = await self._connect(
            self._url,
            additional_headers={"Authorization": f"Bearer {self._api_key}"},
        )
        await self._ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "type": "transcription",
                        "audio": {
                            "input": {
                                "format": {
                                    "type": "audio/pcm",
                                    "rate": _REALTIME_SAMPLE_RATE,
                                },
                                "transcription": {
                                    "model": self._model,
                                    "language": language.split("-", 1)[0],
                                    "delay": self._delay,
                                },
                                "turn_detection": None,
                            }
                        },
                    },
                }
            )
        )
        return self._ws

    async def _close_provider(self) -> None:
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
