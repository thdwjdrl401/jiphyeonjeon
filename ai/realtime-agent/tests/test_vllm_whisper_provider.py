from __future__ import annotations

import json

import httpx
import pytest

from app.audio.segmentation import SpeechSegment
from app.stt.engine import (
    EngineCapabilities,
    EngineCompleted,
    SegmentFinal,
    SttStreamContext,
    TextDelta,
)
from app.stt.providers.vllm_whisper import (
    VllmWhisperRuntimeConfiguration,
    VllmWhisperStreamingEngine,
    probe_vllm_whisper_runtime,
)


def stream_response(*contents: str, finish_reason: str = "stop") -> str:
    events = [
        "data: "
        + json.dumps(
            {"choices": [{"delta": {"content": content}}]},
            ensure_ascii=False,
        )
        + "\n\n"
        for content in contents
    ]
    events.append(
        "data: "
        + json.dumps(
            {
                "choices": [
                    {
                        "delta": {"content": ""},
                        "finish_reason": finish_reason,
                    }
                ]
            }
        )
        + "\n\n"
    )
    events.append("data: [DONE]\n\n")
    return "".join(events)


class SingleSegmenter:
    def __init__(self, segment: SpeechSegment) -> None:
        self._segment = segment

    def push(self, _chunk: object) -> list[SpeechSegment]:
        return []

    def finish(self) -> list[SpeechSegment]:
        return [self._segment]


class SequenceSegmenter:
    def __init__(self, *segments: SpeechSegment) -> None:
        self._segments = list(segments)

    def push(self, _chunk: object) -> list[SpeechSegment]:
        return []

    def finish(self) -> list[SpeechSegment]:
        return self._segments


def configuration(**changes: object) -> VllmWhisperRuntimeConfiguration:
    values = {
        "base_url": "http://127.0.0.1:18083/v1",
        "model": "liveclass-whisper-large-v3",
        "api_key": "runtime-secret",
        "request_timeout_seconds": 20.0,
        "connect_timeout_seconds": 2.0,
    }
    values.update(changes)
    return VllmWhisperRuntimeConfiguration(**values)


@pytest.mark.parametrize(
    "base_url",
    [
        "https://127.0.0.1:18083/v1",
        "http://gpu.example:18083/v1",
        "http://127.0.0.1:18083",
        "http://127.0.0.1:18083/v1?model=whisper",
    ],
)
def test_runtime_configuration_only_accepts_loopback_v1_url(base_url: str) -> None:
    with pytest.raises(RuntimeError, match="loopback HTTP URL ending in /v1"):
        configuration(base_url=base_url).validate()


def test_sync_probe_requires_exact_served_model_and_sends_bearer_token() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "liveclass-whisper-large-v3"}]})

    probe_vllm_whisper_runtime(
        configuration(),
        transport=httpx.MockTransport(handler),
    )

    assert requests[0].url == "http://127.0.0.1:18083/v1/models"
    assert requests[0].headers["Authorization"] == "Bearer runtime-secret"


def test_sync_probe_rejects_a_different_served_model() -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"data": [{"id": "old-checkpoint"}]})
    )

    with pytest.raises(RuntimeError, match="is not in /models"):
        probe_vllm_whisper_runtime(configuration(), transport=transport)


async def test_engine_emits_one_authoritative_final_per_common_vad_segment() -> None:
    segment = SpeechSegment(
        pcm=b"\x01\x00" * 320,
        sample_rate=16_000,
        start_ms=120,
        end_ms=2_120,
        boundary_reason="SILENCE",
        speech_ms=1_800,
        segment_ms=2_500,
        speech_ratio=0.72,
        mean_rms_dbfs=-30.0,
    )
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "liveclass-whisper-large-v3"}]})
        body = await request.aread()
        assert b"liveclass-whisper-large-v3" in body
        assert b'name="language"' in body
        assert b"ko" in body
        assert b'name="stream"' in body
        assert b"true" in body
        assert b"RIFF" in body
        return httpx.Response(
            200,
            text=stream_response("language Korean<asr_text>", "여기를 보세요."),
        )

    engine = VllmWhisperStreamingEngine(
        configuration(),
        segmenter=SingleSegmenter(segment),
        transport=httpx.MockTransport(handler),
    )

    started = await engine.start_stream(SttStreamContext("stream-1", "ko-KR"))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()

    assert started.stt_session_id.startswith("vllm-whisper:")
    assert engine.capabilities == EngineCapabilities(16_000, 1, False)
    assert events == [
        TextDelta("여기를 보세요.", 2_120),
        SegmentFinal("여기를 보세요.", 120, 2_120, "SILENCE"),
        EngineCompleted(0),
    ]
    assert [request.url.path for request in requests] == [
        "/v1/models",
        "/v1/audio/transcriptions",
    ]


@pytest.mark.parametrize(
    ("text", "finish_reason"),
    [
        ("5 " * 200, "stop"),
        ("그래서" * 80, "stop"),
        ("정상으로 시작했지만 끝나지 않은 문장", "length"),
    ],
)
async def test_engine_suppresses_repetition_and_non_eos_completion(
    text: str,
    finish_reason: str,
) -> None:
    segment = SpeechSegment(b"\x01\x00" * 8_000, 16_000, 0, 500)

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "liveclass-whisper-large-v3"}]})
        return httpx.Response(
            200,
            text=stream_response(text, finish_reason=finish_reason),
        )

    engine = VllmWhisperStreamingEngine(
        configuration(),
        segmenter=SingleSegmenter(segment),
        transport=httpx.MockTransport(handler),
    )

    await engine.start_stream(SttStreamContext("stream-1", "ko-KR"))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()

    assert events == [EngineCompleted(0)]


async def test_engine_suppresses_abnormally_dense_output() -> None:
    segment = SpeechSegment(
        b"\x01\x00" * 16_000,
        16_000,
        0,
        1_000,
        segment_ms=1_000,
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "liveclass-whisper-large-v3"}]})
        return httpx.Response(200, text=stream_response("가나다라마바사아자차카타파하"))

    engine = VllmWhisperStreamingEngine(
        configuration(),
        segmenter=SingleSegmenter(segment),
        transport=httpx.MockTransport(handler),
    )

    await engine.start_stream(SttStreamContext("stream-1", "ko-KR"))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()

    assert events == [EngineCompleted(0)]


async def test_engine_suppresses_highly_compressible_output() -> None:
    segment = SpeechSegment(
        b"\x01\x00" * 240_000,
        16_000,
        0,
        15_000,
        segment_ms=15_000,
    )
    text = " ".join(
        f"오늘 강의에서는 데이터베이스 트랜잭션 격리 수준 {index}번을 설명합니다"
        for index in range(3)
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "liveclass-whisper-large-v3"}]})
        return httpx.Response(200, text=stream_response(text))

    engine = VllmWhisperStreamingEngine(
        configuration(),
        segmenter=SingleSegmenter(segment),
        transport=httpx.MockTransport(handler),
    )

    await engine.start_stream(SttStreamContext("stream-1", "ko-KR"))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()

    assert events == [EngineCompleted(0)]


async def test_engine_suppresses_consecutive_duplicate_finals() -> None:
    first = SpeechSegment(
        b"\x01\x00" * 32_000,
        16_000,
        0,
        2_000,
        segment_ms=2_000,
    )
    second = SpeechSegment(
        b"\x01\x00" * 32_000,
        16_000,
        2_500,
        4_500,
        segment_ms=2_000,
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "liveclass-whisper-large-v3"}]})
        return httpx.Response(200, text=stream_response("감사합니다."))

    engine = VllmWhisperStreamingEngine(
        configuration(),
        segmenter=SequenceSegmenter(first, second),
        transport=httpx.MockTransport(handler),
    )

    await engine.start_stream(SttStreamContext("stream-1", "ko-KR"))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()

    assert events == [
        TextDelta("감사합니다.", 2_000),
        SegmentFinal("감사합니다.", 0, 2_000, "SILENCE"),
        EngineCompleted(0),
    ]


async def test_engine_checks_runtime_before_accepting_a_stream() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "loading"})

    engine = VllmWhisperStreamingEngine(
        configuration(),
        segmenter=SingleSegmenter(SpeechSegment(b"", 16_000, 0, 0)),
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(httpx.HTTPStatusError):
        await engine.start_stream(SttStreamContext("stream-1"))
    await engine.close()
