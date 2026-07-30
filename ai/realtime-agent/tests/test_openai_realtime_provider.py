from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import Iterable

import pytest

from app.audio.segmentation import SpeechSegment
from app.stt.engine import AudioChunk, SttStreamContext
from app.stt.providers.openai_realtime import OpenAiRealtimeStreamingEngine
from app.stt.providers.segmented import ProviderSegmentFinal


class FakeWebSocket:
    def __init__(self, responses: Iterable[dict[str, object]]) -> None:
        self.sent: list[dict[str, object]] = []
        self._responses = iter(json.dumps(response) for response in responses)
        self.closed = False

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))

    async def recv(self) -> str:
        return next(self._responses)

    async def close(self) -> None:
        self.closed = True


class NoopSegmenter:
    def push(self, _chunk: AudioChunk) -> list[SpeechSegment]:
        return []

    def finish(self) -> list[SpeechSegment]:
        return []


async def test_uses_current_transcription_session_and_correlates_item_deltas() -> None:
    socket = FakeWebSocket(
        [
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "item-old",
                "delta": "이전 발화",
            },
            {"type": "input_audio_buffer.committed", "item_id": "item-current"},
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "item-old",
                "delta": "무시",
            },
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "item-current",
                "delta": "안녕",
            },
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "item-current",
                "delta": " 하세요",
            },
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "item-current",
                "transcript": "안녕 하세요!",
            },
        ]
    )
    calls: list[tuple[str, dict[str, object]]] = []

    async def connect(url: str, **kwargs: object) -> FakeWebSocket:
        calls.append((url, kwargs))
        return socket

    engine = OpenAiRealtimeStreamingEngine(
        "secret",
        connect=connect,
        segmenter=NoopSegmenter(),
    )
    segment = SpeechSegment(b"\x00\x00" * 320, 16_000, 0, 20)

    deltas = [
        text
        async for text in engine._transcribe(
            segment,
            SttStreamContext("stream-1", "ko-KR"),
        )
    ]

    assert deltas == ["안녕", " 하세요", "!", ProviderSegmentFinal("안녕 하세요!")]
    assert calls == [
        (
            "wss://api.openai.com/v1/realtime?intent=transcription",
            {"additional_headers": {"Authorization": "Bearer secret"}},
        )
    ]
    session = socket.sent[0]["session"]
    assert isinstance(session, dict)
    assert session == {
        "type": "transcription",
        "audio": {
            "input": {
                "format": {"type": "audio/pcm", "rate": 24_000},
                "transcription": {
                    "model": "gpt-realtime-whisper",
                    "language": "ko",
                    "delay": "low",
                },
                "turn_detection": None,
            }
        },
    }
    assert socket.sent[-1] == {"type": "input_audio_buffer.commit"}
    appended = socket.sent[-2]
    assert appended["type"] == "input_audio_buffer.append"
    assert base64.b64decode(str(appended["audio"]))

    await engine.close()
    assert socket.closed is True


async def test_completed_transcript_is_emitted_when_no_delta_was_received() -> None:
    socket = FakeWebSocket(
        [
            {"type": "input_audio_buffer.committed", "item_id": "item-1"},
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "item-1",
                "transcript": "완료 문장",
            },
        ]
    )

    async def connect(_url: str, **_kwargs: object) -> FakeWebSocket:
        return socket

    engine = OpenAiRealtimeStreamingEngine(
        "secret",
        connect=connect,
        segmenter=NoopSegmenter(),
    )
    result = [
        text
        async for text in engine._transcribe(
            SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
            SttStreamContext("stream-1"),
        )
    ]

    assert result == ["완료 문장", ProviderSegmentFinal("완료 문장")]
    await engine.close()


async def test_divergent_final_transcript_is_authoritative_after_realtime_delta(caplog) -> None:
    socket = FakeWebSocket(
        [
            {"type": "input_audio_buffer.committed", "item_id": "item-1"},
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "item-1",
                "delta": "초안",
            },
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "item-1",
                "transcript": "수정본",
            },
        ]
    )

    async def connect(_url: str, **_kwargs: object) -> FakeWebSocket:
        return socket

    engine = OpenAiRealtimeStreamingEngine(
        "secret",
        connect=connect,
        segmenter=NoopSegmenter(),
    )
    result = [
        text
        async for text in engine._transcribe(
            SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
            SttStreamContext("stream-1"),
        )
    ]

    assert result == ["초안", ProviderSegmentFinal("수정본")]
    assert "publishing provider final as authoritative segment text" in caplog.text
    assert "수정본" not in caplog.text
    await engine.close()


async def test_server_error_reaches_provider_consumer() -> None:
    socket = FakeWebSocket([{"type": "error", "error": {"message": "invalid session"}}])

    async def connect(_url: str, **_kwargs: object) -> FakeWebSocket:
        return socket

    engine = OpenAiRealtimeStreamingEngine(
        "secret",
        connect=connect,
        segmenter=NoopSegmenter(),
    )
    transcript = engine._transcribe(
        SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
        SttStreamContext("stream-1"),
    )

    with pytest.raises(RuntimeError, match="invalid session"):
        await anext(transcript)
    await engine.close()


async def test_item_correlated_transcription_failure_reaches_consumer() -> None:
    socket = FakeWebSocket(
        [
            {"type": "input_audio_buffer.committed", "item_id": "item-current"},
            {
                "type": "conversation.item.input_audio_transcription.failed",
                "item_id": "item-old",
                "error": {"message": "stale failure"},
            },
            {
                "type": "conversation.item.input_audio_transcription.failed",
                "item_id": "item-current",
                "error": {"message": "audio unintelligible"},
            },
        ]
    )

    async def connect(_url: str, **_kwargs: object) -> FakeWebSocket:
        return socket

    engine = OpenAiRealtimeStreamingEngine(
        "secret",
        connect=connect,
        segmenter=NoopSegmenter(),
    )
    transcript = engine._transcribe(
        SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
        SttStreamContext("stream-1"),
    )

    with pytest.raises(RuntimeError, match="audio unintelligible"):
        await anext(transcript)
    await engine.close()


async def test_segment_receive_timeout_does_not_wait_forever() -> None:
    class BlockingWebSocket(FakeWebSocket):
        def __init__(self) -> None:
            super().__init__([])

        async def recv(self) -> str:
            await asyncio.Future()
            raise AssertionError("unreachable")

    socket = BlockingWebSocket()

    async def connect(_url: str, **_kwargs: object) -> FakeWebSocket:
        return socket

    engine = OpenAiRealtimeStreamingEngine(
        "secret",
        connect=connect,
        segmenter=NoopSegmenter(),
        segment_timeout_s=0.01,
    )
    transcript = engine._transcribe(
        SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
        SttStreamContext("stream-1"),
    )

    with pytest.raises(TimeoutError, match="0.01s"):
        await anext(transcript)
    await engine.close()


@pytest.mark.parametrize("api_key", ["", " "])
def test_rejects_missing_api_key_before_job_start(api_key: str) -> None:
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        OpenAiRealtimeStreamingEngine(api_key)


def test_rejects_unknown_delay_and_nonpositive_timeout() -> None:
    with pytest.raises(ValueError, match="unsupported OpenAI transcription delay"):
        OpenAiRealtimeStreamingEngine("secret", delay="fast")
    with pytest.raises(ValueError, match="segment_timeout_s must be positive"):
        OpenAiRealtimeStreamingEngine("secret", segment_timeout_s=0)
