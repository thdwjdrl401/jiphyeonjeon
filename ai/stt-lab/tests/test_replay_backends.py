from __future__ import annotations

import asyncio

import numpy as np
import pytest
from app.audio.segmentation import SpeechSegment
from app.stt.engine import AudioChunk, EngineCompleted, SegmentFinal, SttStreamContext, TextDelta

from stt_lab.audio import PcmAudio
from stt_lab.replay_backends import FinalOnlySegmentedEngine, build_backend_slot
from stt_lab.runners import Transcription


class FinishSegmenter:
    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        return []

    def finish(self) -> list[SpeechSegment]:
        return [SpeechSegment(b"\1\0" * 320, 16_000, 0, 20, "STREAM_END")]


class RecordingTranscriber:
    model_id = "recording"
    precision = "float32"

    def __init__(self) -> None:
        self.calls: list[tuple[PcmAudio, str]] = []

    def load(self) -> None:
        return None

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription:
        self.calls.append((audio, language))
        return Transcription("최종 결과", first_delta_ms=4.0, total_ms=4.0)

    def close(self) -> None:
        return None


def test_final_only_adapter_emits_contract_delta_before_authoritative_final() -> None:
    transcriber = RecordingTranscriber()
    engine = FinalOnlySegmentedEngine(
        provider="whisper",
        transcriber=transcriber,
        segmenter=FinishSegmenter(),
    )

    async def run() -> list[object]:
        await engine.start_stream(SttStreamContext("stream-1", "ko-KR"))
        await engine.push_audio(AudioChunk(b"\0\0" * 320, 16_000, 1, 20))
        await engine.finish()
        events = [event async for event in engine.events()]
        await engine.close()
        return events

    events = asyncio.run(run())

    assert engine.capabilities.incremental_deltas is False
    assert events == [
        TextDelta("최종 결과", 20),
        SegmentFinal("최종 결과", 0, 20, "STREAM_END"),
        EngineCompleted(20),
    ]
    assert transcriber.calls[0][0].samples.tolist() == np.ones(320, dtype=np.int16).tolist()
    assert transcriber.calls[0][1] == "ko-KR"


def test_backend_factory_rejects_unknown_provider() -> None:
    with pytest.raises(ValueError, match="unsupported replay backend"):
        build_backend_slot(
            "unknown",
            "model",
            language="ko-KR",
            device="cpu",
            precision="float32",
        )
