from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass
from threading import Event
from typing import Any, Protocol

import numpy as np

from app.audio.segmentation import SpeechSegment
from app.stt.engine import SttStreamContext
from app.stt.providers.segmented import SegmentedStreamingEngine, SpeechSegmenter

_PRODUCER_DONE = object()


class NemotronRecognizer(Protocol):
    def transcribe_stream(
        self,
        pcm_int16: np.ndarray[Any, np.dtype[np.int16]],
        input_sample_rate: int,
        stop_requested: Event,
    ) -> Iterable[str]: ...

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class _ProducerFailure:
    error: Exception


class _RecognizerLoadAborted(RuntimeError):
    """The recognizer finished loading after its engine had begun closing."""


class NemotronStreamingEngine(SegmentedStreamingEngine):
    """Bridge one bounded segment at a time to an owned Nemotron recognizer."""

    def __init__(
        self,
        model_id: str,
        language: str,
        *,
        recognizer_factory: Callable[[str, str], NemotronRecognizer] | None = None,
        prewarmed_recognizer: NemotronRecognizer | None = None,
        segmenter: SpeechSegmenter | None = None,
    ) -> None:
        if not model_id.strip():
            raise ValueError("Nemotron model_id must not be blank")
        if not language.strip():
            raise ValueError("Nemotron language must not be blank")
        if recognizer_factory is not None and prewarmed_recognizer is not None:
            raise ValueError("recognizer_factory and prewarmed_recognizer are mutually exclusive")

        super().__init__("nemotron", segmenter=segmenter)
        self._model_id = model_id
        self._language = language
        self._recognizer_factory = recognizer_factory or self._default_factory
        self._recognizer = prewarmed_recognizer
        self._recognizer_load_task: asyncio.Task[NemotronRecognizer] | None = None
        self._provider_closed = Event()
        self._inference_lock = asyncio.Lock()

    async def _transcribe(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> AsyncIterator[str]:
        del context
        async with self._inference_lock:
            recognizer = await self._get_or_load_recognizer()
            samples = np.frombuffer(segment.pcm, dtype="<i2")
            loop = asyncio.get_running_loop()
            chunks: asyncio.Queue[str | _ProducerFailure | object] = asyncio.Queue()
            stop_requested = Event()

            def publish(item: str | _ProducerFailure | object) -> None:
                try:
                    loop.call_soon_threadsafe(chunks.put_nowait, item)
                except RuntimeError:
                    return

            def produce() -> None:
                try:
                    transcript = recognizer.transcribe_stream(
                        samples,
                        segment.sample_rate,
                        stop_requested,
                    )
                    for chunk in transcript:
                        if stop_requested.is_set():
                            break
                        publish(chunk)
                except Exception as exc:  # noqa: BLE001 - cross the thread boundary
                    publish(_ProducerFailure(exc))
                finally:
                    publish(_PRODUCER_DONE)

            producer = asyncio.create_task(
                asyncio.to_thread(produce),
                name="nemotron-transcript-producer",
            )
            try:
                while (item := await chunks.get()) is not _PRODUCER_DONE:
                    if isinstance(item, _ProducerFailure):
                        raise item.error
                    if item:
                        assert isinstance(item, str)
                        yield item
                await producer
            finally:
                stop_requested.set()
                if not producer.done():
                    producer.cancel()
                await asyncio.gather(producer, return_exceptions=True)

    async def _get_or_load_recognizer(self) -> NemotronRecognizer:
        if self._provider_closed.is_set():
            raise RuntimeError("Nemotron provider is closed")
        if self._recognizer is not None:
            return self._recognizer

        if self._recognizer_load_task is None:
            self._recognizer_load_task = asyncio.create_task(
                self._load_recognizer(),
                name="nemotron-recognizer-loader",
            )
        # Cancelling a stream must not orphan a model factory thread. The provider's
        # close path keeps ownership of this task and disposes its eventual result.
        return await asyncio.shield(self._recognizer_load_task)

    async def _load_recognizer(self) -> NemotronRecognizer:
        recognizer = await asyncio.to_thread(self._create_recognizer)
        if self._provider_closed.is_set():
            await asyncio.to_thread(self._close_recognizer, recognizer)
            raise _RecognizerLoadAborted("Nemotron provider closed while loading")

        # This assignment and _close_provider run on the same event loop. There is
        # no suspension point between the final closed check and ownership transfer.
        self._recognizer = recognizer
        return recognizer

    def _create_recognizer(self) -> NemotronRecognizer:
        recognizer = self._recognizer_factory(self._model_id, self._language)
        # Also check in the loader thread. If the event loop itself is shutting down,
        # a late factory result is still released without relying on another callback.
        if self._provider_closed.is_set():
            self._close_recognizer(recognizer)
            raise _RecognizerLoadAborted("Nemotron provider closed while loading")
        return recognizer

    @staticmethod
    def _close_recognizer(recognizer: NemotronRecognizer) -> None:
        close = getattr(recognizer, "close", None)
        if callable(close):
            close()

    @staticmethod
    def _default_factory(model_id: str, language: str) -> NemotronRecognizer:
        try:
            from app.stt.nemotron_asr import NemotronStreamingASR
        except ImportError as exc:
            raise RuntimeError(
                "Nemotron dependencies are missing; run `uv sync --extra nemotron`"
            ) from exc
        return NemotronStreamingASR(model_id, language)

    async def _close_provider(self) -> None:
        self._provider_closed.set()

        load_task = self._recognizer_load_task
        if load_task is not None:
            try:
                await asyncio.shield(load_task)
            except _RecognizerLoadAborted:
                # Provider shutdown owns the late result; _load_recognizer either
                # transferred it to self._recognizer or released it before failing.
                self._recognizer = None
            finally:
                self._recognizer_load_task = None

        recognizer, self._recognizer = self._recognizer, None
        if recognizer is not None:
            await asyncio.to_thread(self._close_recognizer, recognizer)
