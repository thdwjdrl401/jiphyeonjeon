from __future__ import annotations

import pytest

from app.stt.engine import (
    AudioChunk,
    EngineCompleted,
    SttStreamContext,
    TextDelta,
)
from app.stt.providers.stub import StubStreamingEngine


async def test_stub_emits_deterministic_deltas_and_opaque_session_id() -> None:
    engine = StubStreamingEngine(
        "조각",
        session_id_factory=lambda: "opaque-stt-session",
    )
    context = SttStreamContext(
        stream_id="room-a",
    )

    started = await engine.start_stream(context)
    await engine.push_audio(AudioChunk(b"first", 48_000, 1, 20))
    await engine.push_audio(AudioChunk(b"second", 48_000, 1, 40))
    await engine.finish()
    events = [event async for event in engine.events()]
    await engine.close()

    assert started.stt_session_id == "opaque-stt-session"
    assert engine.capabilities.sample_rate == 48_000
    assert events == [
        TextDelta("조각", 20),
        TextDelta("조각", 40),
        EngineCompleted(40),
    ]
    assert engine.started is False


async def test_stub_rejects_audio_before_start_and_after_finish() -> None:
    engine = StubStreamingEngine(session_id_factory=lambda: "id")
    chunk = AudioChunk(b"pcm", 48_000, 1, 20)

    with pytest.raises(RuntimeError, match="not started"):
        await engine.push_audio(chunk)

    await engine.start_stream(SttStreamContext("room-a"))
    await engine.finish()

    with pytest.raises(RuntimeError, match="already finished"):
        await engine.push_audio(chunk)

    await engine.close()


async def test_stub_rejects_second_start_and_events_consumer() -> None:
    engine = StubStreamingEngine(session_id_factory=lambda: "id")
    context = SttStreamContext("room-a")
    await engine.start_stream(context)

    with pytest.raises(RuntimeError, match="already started"):
        await engine.start_stream(context)

    await engine.finish()
    assert [event async for event in engine.events()] == [EngineCompleted(0)]
    with pytest.raises(RuntimeError, match="only be consumed once"):
        await anext(engine.events())
    await engine.close()


def test_internal_models_reject_invalid_time_and_stream_id() -> None:
    with pytest.raises(ValueError, match="stream_elapsed_ms"):
        AudioChunk(b"pcm", 16_000, 1, -1)
    with pytest.raises(ValueError, match="stream_id"):
        SttStreamContext(" ")
