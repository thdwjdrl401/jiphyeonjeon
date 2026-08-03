from __future__ import annotations

import asyncio

import httpx
import numpy as np
import pytest
from app.audio.segmentation import SpeechSegment
from app.stt.engine import (
    AudioChunk,
    EngineCompleted,
    SegmentFinal,
    StreamingSttEngine,
    SttStreamContext,
    TextDelta,
)

from stt_lab.qwen_vllm_streaming import (
    QwenVllmStreamingBackendSlot,
    QwenVllmStreamingConfiguration,
)


class FinishSegmenter:
    def __init__(self) -> None:
        self._pcm = bytearray()
        self._end_ms = 0

    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        self._pcm.extend(chunk.pcm)
        self._end_ms = chunk.stream_elapsed_ms
        return []

    def finish(self) -> list[SpeechSegment]:
        return [
            SpeechSegment(
                bytes(self._pcm),
                16_000,
                0,
                self._end_ms,
                "STREAM_END",
            )
        ]


def test_qwen_streaming_protocol_emits_deltas_and_authoritative_final() -> None:
    chunk_payloads: list[bytes] = []
    chunk_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal chunk_count
        if request.method == "GET" and request.url.path == "/":
            return httpx.Response(200, text="ready")
        if request.url.path == "/api/start":
            return httpx.Response(200, json={"session_id": "session-1"})
        if request.url.path == "/api/chunk":
            assert request.url.params["session_id"] == "session-1"
            assert request.headers["content-type"] == "application/octet-stream"
            chunk_payloads.append(request.content)
            chunk_count += 1
            text = "안녕" if chunk_count == 1 else "안녕하세요"
            return httpx.Response(200, json={"language": "Korean", "text": text})
        if request.url.path == "/api/finish":
            assert request.url.params["session_id"] == "session-1"
            return httpx.Response(200, json={"language": "Korean", "text": "안녕하세요."})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    slot = QwenVllmStreamingBackendSlot(
        "Qwen/Qwen3-ASR-0.6B",
        configuration=QwenVllmStreamingConfiguration(
            base_url="http://127.0.0.1:18084",
            chunk_ms=500,
        ),
        precision="bfloat16",
        transport=httpx.MockTransport(handler),
    )
    slot.load()

    samples = np.zeros(16_000, dtype="<i2")
    samples[:3] = (-32768, 0, 32767)

    async def run() -> list[object]:
        engine = slot.create_engine(FinishSegmenter())
        await engine.start_stream(SttStreamContext("qwen-test", "ko-KR"))
        collector = asyncio.create_task(_collect_events(engine))
        try:
            await engine.push_audio(
                AudioChunk(
                    pcm=samples.tobytes(),
                    sample_rate=16_000,
                    num_channels=1,
                    stream_elapsed_ms=1_000,
                )
            )
            await engine.finish()
            return await collector
        finally:
            await engine.close()

    events = asyncio.run(run())
    slot.close()

    deltas = [event.text for event in events if isinstance(event, TextDelta)]
    finals = [event for event in events if isinstance(event, SegmentFinal)]
    assert deltas == ["안녕", "하세요"]
    assert [
        (event.text, event.start_stream_elapsed_ms, event.end_stream_elapsed_ms) for event in finals
    ] == [("안녕하세요.", 0, 1_000)]
    assert isinstance(events[-1], EngineCompleted)
    assert len(chunk_payloads) == 2
    first_chunk = np.frombuffer(chunk_payloads[0], dtype="<f4")
    assert first_chunk[:3] == pytest.approx((-1.0, 0.0, 32767 / 32768))


@pytest.mark.parametrize(
    "base_url",
    (
        "https://127.0.0.1:18084",
        "http://gpu.internal:18084",
        "http://127.0.0.1",
        "http://127.0.0.1:18084/api",
        "http://user:secret@127.0.0.1:18084",
    ),
)
def test_qwen_streaming_server_is_restricted_to_explicit_loopback_origin(
    base_url: str,
) -> None:
    with pytest.raises(ValueError):
        QwenVllmStreamingConfiguration(base_url=base_url)


async def _collect_events(engine: StreamingSttEngine) -> list[object]:
    collected: list[object] = []
    async for event in engine.events():
        collected.append(event)
    return collected
