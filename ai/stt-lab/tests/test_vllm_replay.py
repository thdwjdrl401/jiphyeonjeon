from __future__ import annotations

import asyncio

import httpx
import pytest
from app.audio.segmentation import SpeechSegment
from app.stt.engine import AudioChunk, EngineCompleted, SegmentFinal, SttStreamContext

from stt_lab.vllm_replay import VllmBackendSlot


class FinishSegmenter:
    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        return []

    def finish(self) -> list[SpeechSegment]:
        return [SpeechSegment(b"\1\0" * 320, 16_000, 0, 20, "STREAM_END")]


def test_vllm_slot_consumes_product_segment_and_emits_final_only() -> None:
    paths: list[str] = []
    request_bodies: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "served-whisper"}]})
        if request.url.path == "/v1/audio/transcriptions":
            request_bodies.append(request.read())
            return httpx.Response(200, json={"text": "서버 최종 결과"})
        return httpx.Response(404)

    slot = VllmBackendSlot(
        "served-whisper",
        base_url="http://test/v1",
        api_key=None,
        precision="bfloat16",
        timeout_seconds=5,
        transport=httpx.MockTransport(handler),
    )
    slot.load()
    engine = slot.create_engine(FinishSegmenter())

    async def run() -> list[object]:
        await engine.start_stream(SttStreamContext("stream-vllm", "ko-KR"))
        await engine.push_audio(AudioChunk(b"\0\0" * 320, 16_000, 1, 20))
        await engine.finish()
        events = [event async for event in engine.events()]
        await engine.close()
        return events

    events = asyncio.run(run())
    slot.close()

    assert slot.metadata.output_mode == "SEGMENT_FINAL_ONLY"
    assert events == [
        SegmentFinal("서버 최종 결과", 0, 20, "STREAM_END"),
        EngineCompleted(20),
    ]
    assert paths == ["/v1/models", "/v1/audio/transcriptions"]
    assert b"RIFF" in request_bodies[0]
    assert b"\r\n\r\nko\r\n" in request_bodies[0]


def test_vllm_slot_fails_when_requested_model_is_not_served() -> None:
    slot = VllmBackendSlot(
        "missing-model",
        base_url="http://test/v1",
        api_key=None,
        precision="bfloat16",
        timeout_seconds=5,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"data": [{"id": "other-model"}]})
        ),
    )

    with pytest.raises(ValueError, match="not in /models"):
        slot.load()
    slot.close()
