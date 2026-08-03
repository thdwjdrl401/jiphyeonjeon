from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from threading import Event
from typing import Any, Literal, Protocol

import numpy as np
from app.audio.segmentation import SpeechSegment
from app.stt.engine import EngineCapabilities, StreamingSttEngine, SttStreamContext
from app.stt.providers.nemotron import NemotronRecognizer, NemotronStreamingEngine
from app.stt.providers.segmented import (
    ProviderSegmentFinal,
    SegmentedStreamingEngine,
    SpeechSegmenter,
)

from stt_lab.audio import PcmAudio
from stt_lab.runners import Transcriber, WhisperTransformersRunner

OutputMode = Literal["INCREMENTAL", "SEGMENT_FINAL_ONLY"]


@dataclass(frozen=True)
class BackendMetadata:
    backend: str
    model_id: str
    precision: str
    output_mode: OutputMode


class ReplayBackendSlot(Protocol):
    @property
    def metadata(self) -> BackendMetadata: ...

    def load(self) -> None: ...

    def create_engine(self, segmenter: SpeechSegmenter) -> StreamingSttEngine: ...

    def close(self) -> None: ...


class NemotronBackendSlot:
    """Own one model resource, mirroring one prewarmed realtime-agent job slot."""

    def __init__(self, model_id: str, *, language: str) -> None:
        self._model_id = model_id
        self._language = language
        self._recognizer: NemotronRecognizer | None = None

    @property
    def metadata(self) -> BackendMetadata:
        return BackendMetadata(
            backend="nemotron",
            model_id=self._model_id,
            precision="runtime-default",
            output_mode="INCREMENTAL",
        )

    def load(self) -> None:
        if self._recognizer is not None:
            raise RuntimeError("Nemotron backend slot is already loaded")
        try:
            from app.stt.nemotron_asr import NemotronStreamingASR
        except ImportError as exc:
            raise RuntimeError(
                "Nemotron dependencies are missing; sync the STT Lab environment"
            ) from exc
        recognizer = NemotronStreamingASR(self._model_id, self._language)
        recognizer.load()
        self._recognizer = recognizer

    def create_engine(self, segmenter: SpeechSegmenter) -> StreamingSttEngine:
        if self._recognizer is None:
            raise RuntimeError("Nemotron backend slot is not loaded")
        return NemotronStreamingEngine(
            self._model_id,
            self._language,
            prewarmed_recognizer=_BorrowedNemotronRecognizer(self._recognizer),
            segmenter=segmenter,
        )

    def close(self) -> None:
        recognizer, self._recognizer = self._recognizer, None
        if recognizer is not None:
            recognizer.close()


class WhisperBackendSlot:
    def __init__(self, model_id: str, *, device: str, precision: str) -> None:
        self._runner: Transcriber = WhisperTransformersRunner(
            model_id,
            device=device,
            precision=precision,
        )
        self._loaded = False

    @property
    def metadata(self) -> BackendMetadata:
        return BackendMetadata(
            backend="whisper",
            model_id=self._runner.model_id,
            precision=self._runner.precision,
            output_mode="SEGMENT_FINAL_ONLY",
        )

    def load(self) -> None:
        if self._loaded:
            raise RuntimeError("Whisper backend slot is already loaded")
        self._runner.load()
        self._loaded = True

    def create_engine(self, segmenter: SpeechSegmenter) -> StreamingSttEngine:
        if not self._loaded:
            raise RuntimeError("Whisper backend slot is not loaded")
        return FinalOnlySegmentedEngine(
            provider="whisper",
            transcriber=self._runner,
            segmenter=segmenter,
        )

    def close(self) -> None:
        if self._loaded:
            self._runner.close()
            self._loaded = False


class FinalOnlySegmentedEngine(SegmentedStreamingEngine):
    """Adapt a synchronous segment transcriber to the product segmented lifecycle."""

    def __init__(
        self,
        *,
        provider: str,
        transcriber: Transcriber,
        segmenter: SpeechSegmenter,
    ) -> None:
        super().__init__(provider, segmenter=segmenter)
        self._transcriber = transcriber

    @property
    def capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(sample_rate=16_000, num_channels=1, incremental_deltas=False)

    async def _transcribe(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> AsyncIterator[ProviderSegmentFinal]:
        audio = _segment_audio(segment)
        transcription = await asyncio.to_thread(
            self._transcriber.transcribe,
            audio,
            context.language,
        )
        if transcription.text:
            yield ProviderSegmentFinal(transcription.text)


class _BorrowedNemotronRecognizer:
    """Keep the slot-owned recognizer alive when a one-stream engine closes."""

    def __init__(self, recognizer: NemotronRecognizer) -> None:
        self._recognizer = recognizer

    def transcribe_stream(
        self,
        pcm_int16: np.ndarray[Any, np.dtype[np.int16]],
        input_sample_rate: int,
        stop_requested: Event,
    ) -> Iterable[str]:
        return self._recognizer.transcribe_stream(
            pcm_int16,
            input_sample_rate,
            stop_requested,
        )

    def close(self) -> None:
        return None


def build_backend_slot(
    backend: str,
    model_id: str,
    *,
    language: str,
    device: str,
    precision: str,
) -> ReplayBackendSlot:
    if backend == "nemotron":
        return NemotronBackendSlot(model_id, language=language)
    if backend == "whisper":
        return WhisperBackendSlot(model_id, device=device, precision=precision)
    raise ValueError(f"unsupported replay backend: {backend}")


def _segment_audio(segment: SpeechSegment) -> PcmAudio:
    samples = np.frombuffer(segment.pcm, dtype="<i2").copy()
    return PcmAudio(
        samples=samples,
        sample_rate=segment.sample_rate,
        duration_ms=round(samples.size * 1_000 / segment.sample_rate),
        sha256=hashlib.sha256(segment.pcm).hexdigest(),
    )
