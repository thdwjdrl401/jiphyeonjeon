from __future__ import annotations

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
from app.stt.providers.nemotron_nemo import (
    NemotronNemoRuntimeConfiguration,
    NemotronNemoStreamingEngine,
    probe_nemotron_nemo_runtime,
)


class SingleSegmenter:
    def __init__(self, segment: SpeechSegment) -> None:
        self._segment = segment

    def push(self, _chunk: object) -> list[SpeechSegment]:
        return []

    def finish(self) -> list[SpeechSegment]:
        return [self._segment]


def configuration(**changes: object) -> NemotronNemoRuntimeConfiguration:
    values = {
        "base_url": "http://127.0.0.1:18084/v1",
        "model": "liveclass-nemotron-3.5-tuned",
        "api_key": "",
        "request_timeout_seconds": 20.0,
        "connect_timeout_seconds": 2.0,
    }
    values.update(changes)
    return NemotronNemoRuntimeConfiguration(**values)


@pytest.mark.parametrize(
    "base_url",
    [
        "https://127.0.0.1:18084/v1",
        "http://gpu.example:18084/v1",
        "http://127.0.0.1:18084",
        "http://127.0.0.1:18084/v1?model=whisper",
    ],
)
def test_runtime_configuration_only_accepts_loopback_v1_url(base_url: str) -> None:
    with pytest.raises(RuntimeError, match="loopback HTTP URL ending in /v1"):
        configuration(base_url=base_url).validate()


def test_sync_probe_requires_exact_served_model_without_authentication() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "liveclass-nemotron-3.5-tuned"}]})

    probe_nemotron_nemo_runtime(
        configuration(),
        transport=httpx.MockTransport(handler),
    )

    assert requests[0].url == "http://127.0.0.1:18084/v1/models"
    assert "Authorization" not in requests[0].headers


def test_sync_probe_rejects_a_different_served_model() -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"data": [{"id": "old-checkpoint"}]})
    )

    with pytest.raises(RuntimeError, match="is not in /models"):
        probe_nemotron_nemo_runtime(configuration(), transport=transport)


async def test_engine_emits_one_authoritative_final_per_common_vad_segment() -> None:
    segment = SpeechSegment(
        pcm=b"\x01\x00" * 320,
        sample_rate=16_000,
        start_ms=120,
        end_ms=140,
        boundary_reason="SILENCE",
    )
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "liveclass-nemotron-3.5-tuned"}]})
        body = await request.aread()
        assert b"liveclass-nemotron-3.5-tuned" in body
        assert b'name="language"' in body
        assert b"ko" in body
        assert b"RIFF" in body
        return httpx.Response(200, json={"text": "language Korean<asr_text>여기를 보세요."})

    engine = NemotronNemoStreamingEngine(
        configuration(),
        segmenter=SingleSegmenter(segment),
        transport=httpx.MockTransport(handler),
    )

    started = await engine.start_stream(SttStreamContext("stream-1", "ko-KR"))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()

    assert started.stt_session_id.startswith("nemotron-nemo:")
    assert engine.capabilities == EngineCapabilities(16_000, 1, False)
    assert events == [
        TextDelta("여기를 보세요.", 140),
        SegmentFinal("여기를 보세요.", 120, 140, "SILENCE"),
        EngineCompleted(0),
    ]
    assert [request.url.path for request in requests] == [
        "/v1/models",
        "/v1/audio/transcriptions",
    ]


async def test_engine_checks_runtime_before_accepting_a_stream() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "loading"})

    engine = NemotronNemoStreamingEngine(
        configuration(),
        segmenter=SingleSegmenter(SpeechSegment(b"", 16_000, 0, 0)),
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(httpx.HTTPStatusError):
        await engine.start_stream(SttStreamContext("stream-1"))
    await engine.close()
