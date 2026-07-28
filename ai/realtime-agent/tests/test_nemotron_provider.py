from __future__ import annotations

import asyncio
from collections.abc import Iterable
from threading import Event

import numpy as np
import pytest

from app.audio.segmentation import SpeechSegment
from app.stt.engine import AudioChunk, SttStreamContext
from app.stt.providers.nemotron import NemotronStreamingEngine


class NoopSegmenter:
    def push(self, _chunk: AudioChunk) -> list[SpeechSegment]:
        return []

    def finish(self) -> list[SpeechSegment]:
        return []


class FakeRecognizer:
    def __init__(self, chunks: Iterable[str] = ("강의", " 시작합니다")) -> None:
        self._chunks = chunks
        self.calls = 0
        self.close_calls = 0

    def transcribe_stream(
        self,
        pcm_int16: np.ndarray,
        input_sample_rate: int,
        stop_requested: Event,
    ) -> Iterable[str]:
        self.calls += 1
        assert pcm_int16.dtype == np.dtype("int16")
        assert input_sample_rate == 16_000
        assert not stop_requested.is_set()
        return self._chunks

    def close(self) -> None:
        self.close_calls += 1


async def test_nemotron_preserves_model_chunks_and_loads_recognizer_once() -> None:
    recognizer = FakeRecognizer()
    factory_calls = 0

    def factory(_model: str, _language: str) -> FakeRecognizer:
        nonlocal factory_calls
        factory_calls += 1
        return recognizer

    engine = NemotronStreamingEngine(
        "model",
        "ko-KR",
        recognizer_factory=factory,
        segmenter=NoopSegmenter(),
    )
    segment = SpeechSegment(b"\x00\x00" * 320, 16_000, 0, 20)

    first = [text async for text in engine._transcribe(segment, SttStreamContext("stream-1"))]
    second = [text async for text in engine._transcribe(segment, SttStreamContext("stream-1"))]

    assert first == second == ["강의", " 시작합니다"]
    assert factory_calls == 1
    assert recognizer.calls == 2
    await engine.close()
    assert recognizer.close_calls == 1


async def test_prewarmed_recognizer_is_used_without_factory_and_owned_by_engine() -> None:
    recognizer = FakeRecognizer()
    engine = NemotronStreamingEngine(
        "model",
        "ko-KR",
        prewarmed_recognizer=recognizer,
        segmenter=NoopSegmenter(),
    )
    segment = SpeechSegment(b"\x00\x00" * 320, 16_000, 0, 20)

    result = [text async for text in engine._transcribe(segment, SttStreamContext("stream-1"))]

    assert result == ["강의", " 시작합니다"]
    assert recognizer.calls == 1
    await engine.close()
    assert recognizer.close_calls == 1


def test_rejects_factory_and_prewarmed_recognizer_together() -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        NemotronStreamingEngine(
            "model",
            "ko-KR",
            recognizer_factory=lambda _model, _language: FakeRecognizer(),
            prewarmed_recognizer=FakeRecognizer(),
        )


async def test_recognizer_failure_reaches_async_consumer_without_hanging() -> None:
    class FailingRecognizer(FakeRecognizer):
        def transcribe_stream(
            self,
            pcm_int16: np.ndarray,
            input_sample_rate: int,
            stop_requested: Event,
        ) -> Iterable[str]:
            del pcm_int16, input_sample_rate, stop_requested
            raise RuntimeError("GPU inference failed")

    engine = NemotronStreamingEngine(
        "model",
        "ko-KR",
        recognizer_factory=lambda _model, _language: FailingRecognizer(),
        segmenter=NoopSegmenter(),
    )
    transcript = engine._transcribe(
        SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
        SttStreamContext("stream-1"),
    )

    with pytest.raises(RuntimeError, match="GPU inference failed"):
        await asyncio.wait_for(anext(transcript), timeout=1)
    await engine.close()


async def test_cancelled_consumer_does_not_wait_for_recognizer_thread() -> None:
    producer_exited = Event()

    class BlockingRecognizer(FakeRecognizer):
        def transcribe_stream(
            self,
            pcm_int16: np.ndarray,
            input_sample_rate: int,
            stop_requested: Event,
        ) -> Iterable[str]:
            del pcm_int16, input_sample_rate

            def chunks() -> Iterable[str]:
                try:
                    yield "first"
                    if not stop_requested.wait(timeout=2):
                        yield "late"
                finally:
                    producer_exited.set()

            return chunks()

    engine = NemotronStreamingEngine(
        "model",
        "ko-KR",
        recognizer_factory=lambda _model, _language: BlockingRecognizer(),
        segmenter=NoopSegmenter(),
    )
    transcript = engine._transcribe(
        SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
        SttStreamContext("stream-1"),
    )
    assert await anext(transcript) == "first"

    pending = asyncio.create_task(anext(transcript))
    await asyncio.sleep(0)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(pending, timeout=0.2)

    assert await asyncio.to_thread(producer_exited.wait, 0.5)
    await engine.close()


async def test_close_owns_and_releases_recognizer_that_finishes_loading_late() -> None:
    factory_started = Event()
    allow_factory_return = Event()
    recognizer = FakeRecognizer()

    def factory(_model: str, _language: str) -> FakeRecognizer:
        factory_started.set()
        if not allow_factory_return.wait(timeout=2):
            raise TimeoutError("test did not release recognizer factory")
        return recognizer

    engine = NemotronStreamingEngine(
        "model",
        "ko-KR",
        recognizer_factory=factory,
        segmenter=NoopSegmenter(),
    )
    transcript = engine._transcribe(
        SpeechSegment(b"\0\0" * 320, 16_000, 0, 20),
        SttStreamContext("stream-1"),
    )
    pending_transcript = asyncio.create_task(anext(transcript))
    assert await asyncio.to_thread(factory_started.wait, 0.5)

    close_task = asyncio.create_task(engine.close())
    _, still_pending = await asyncio.wait({close_task}, timeout=0.05)
    assert close_task in still_pending
    assert not allow_factory_return.is_set()

    allow_factory_return.set()
    await asyncio.wait_for(close_task, timeout=0.5)
    await asyncio.gather(pending_transcript, return_exceptions=True)

    assert recognizer.close_calls == 1
    assert engine._recognizer is None


@pytest.mark.parametrize(
    ("model_id", "language", "message"),
    [("", "ko-KR", "model_id"), ("model", " ", "language")],
)
def test_rejects_blank_configuration(model_id: str, language: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        NemotronStreamingEngine(model_id, language)
