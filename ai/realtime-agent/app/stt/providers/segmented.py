from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from app.audio.segmentation import SpeechSegment, VadSegmenter
from app.stt.engine import (
    AudioChunk,
    EngineCapabilities,
    EngineCompleted,
    EngineEvent,
    EngineWarning,
    SegmentFinal,
    SttStreamContext,
    SttStreamStarted,
    TextDelta,
)

_STOP = object()
_EVENTS_CLOSED = object()

logger = logging.getLogger(__name__)


class SpeechSegmenter(Protocol):
    def push(self, chunk: AudioChunk) -> list[SpeechSegment]: ...

    def finish(self) -> list[SpeechSegment]: ...


@dataclass(frozen=True, slots=True)
class _WorkerFailure:
    error: Exception


@dataclass(frozen=True, slots=True)
class ProviderSegmentFinal:
    """Provider-authoritative final transcript for one VAD segment."""

    text: str


class SegmentedStreamingEngine(ABC):
    """Run provider requests serially over bounded, provider-neutral speech segments."""

    def __init__(
        self,
        provider: str,
        *,
        segmenter: SpeechSegmenter | None = None,
        segment_queue_size: int = 8,
        event_queue_size: int = 64,
    ) -> None:
        if not provider.strip():
            raise ValueError("provider must not be blank")
        if segment_queue_size <= 0:
            raise ValueError("segment_queue_size must be positive")
        if event_queue_size <= 0:
            raise ValueError("event_queue_size must be positive")

        self._provider = provider
        self._segmenter = segmenter or VadSegmenter()
        self._segments: asyncio.Queue[SpeechSegment | object] = asyncio.Queue(segment_queue_size)
        self._events: asyncio.Queue[EngineEvent | _WorkerFailure | object] = asyncio.Queue(
            event_queue_size
        )
        self._worker: asyncio.Task[None] | None = None
        self._started = False
        self._finish_requested = False
        self._closed = False
        self._events_taken = False
        self._last_stream_elapsed_ms = 0

    @property
    def capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(sample_rate=16_000, num_channels=1, incremental_deltas=True)

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted:
        if self._closed:
            raise RuntimeError("STT engine is closed")
        if self._started:
            raise RuntimeError("STT stream already started")

        self._started = True
        self._worker = asyncio.create_task(
            self._run_segments(context),
            name=f"segmented-stt:{self._provider}",
        )
        return SttStreamStarted(f"{self._provider}:{uuid4().hex}")

    async def push_audio(self, chunk: AudioChunk) -> None:
        self._require_active()
        if self._finish_requested:
            raise RuntimeError("STT stream is already finishing")
        self._raise_worker_failure()

        self._last_stream_elapsed_ms = max(
            self._last_stream_elapsed_ms,
            chunk.stream_elapsed_ms,
        )
        for segment in self._segmenter.push(chunk):
            await self._enqueue_segment(segment)

    async def events(self) -> AsyncIterator[EngineEvent]:
        self._require_active()
        if self._events_taken:
            raise RuntimeError("STT events can only be consumed once")
        self._events_taken = True

        while True:
            item = await self._events.get()
            if item is _EVENTS_CLOSED:
                return
            if isinstance(item, _WorkerFailure):
                raise item.error
            assert isinstance(item, EngineEvent)
            yield item
            if isinstance(item, EngineCompleted):
                return

    async def finish(self) -> None:
        self._require_active()
        if self._finish_requested:
            raise RuntimeError("STT stream is already finishing")
        self._raise_worker_failure()
        self._finish_requested = True

        for segment in self._segmenter.finish():
            await self._enqueue_segment(segment)
        await self._enqueue_segment(_STOP)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True

        try:
            if self._worker is not None:
                if not self._worker.done():
                    self._worker.cancel()
                await asyncio.gather(self._worker, return_exceptions=True)
        finally:
            self._started = False
            try:
                await self._close_provider()
            finally:
                while not self._events.empty():
                    self._events.get_nowait()
                self._events.put_nowait(_EVENTS_CLOSED)

    async def _enqueue_segment(self, item: SpeechSegment | object) -> None:
        worker = self._worker
        if worker is None:
            raise RuntimeError("STT segment worker is not running")
        self._raise_worker_failure()
        if worker.done():
            raise RuntimeError("STT segment worker stopped unexpectedly")

        enqueue_task = asyncio.create_task(self._segments.put(item))
        try:
            await asyncio.wait(
                {enqueue_task, worker},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if enqueue_task.done():
                await enqueue_task
                return

            self._raise_worker_failure()
            raise RuntimeError("STT segment worker stopped unexpectedly")
        finally:
            if not enqueue_task.done():
                enqueue_task.cancel()
                await asyncio.gather(enqueue_task, return_exceptions=True)

    async def _run_segments(self, context: SttStreamContext) -> None:
        try:
            while (item := await self._segments.get()) is not _STOP:
                assert isinstance(item, SpeechSegment)
                transcript = self._transcribe(item, context)
                provider_wall_latency_ms = 0.0
                emitted_parts: list[str] = []
                authoritative_final: str | None = None
                while True:
                    started_at = time.perf_counter()
                    try:
                        output = await anext(transcript)
                    except StopAsyncIteration:
                        provider_wall_latency_ms += (time.perf_counter() - started_at) * 1_000
                        break
                    provider_wall_latency_ms += (time.perf_counter() - started_at) * 1_000
                    if isinstance(output, ProviderSegmentFinal):
                        authoritative_final = output.text
                    elif output:
                        emitted_parts.append(output)
                        await self._events.put(TextDelta(output, item.end_ms))
                final_text = (
                    authoritative_final
                    if authoritative_final is not None
                    else "".join(emitted_parts)
                )
                if final_text:
                    if not emitted_parts:
                        await self._events.put(TextDelta(final_text, item.end_ms))
                    await self._events.put(
                        SegmentFinal(
                            final_text,
                            item.start_ms,
                            item.end_ms,
                            item.boundary_reason,
                        )
                    )
                logger.debug(
                    "STT segment processed: provider=%s segment_duration_ms=%d "
                    "provider_wall_latency_ms=%.3f queue_depth=%d",
                    self._provider,
                    item.end_ms - item.start_ms,
                    provider_wall_latency_ms,
                    self._segments.qsize(),
                )
            await self._events.put(EngineCompleted(self._last_stream_elapsed_ms))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._events.put(EngineWarning("PROVIDER_ERROR", str(exc)))
            await self._events.put(_WorkerFailure(exc))
            raise

    def _require_active(self) -> None:
        if self._closed:
            raise RuntimeError("STT engine is closed")
        if not self._started:
            raise RuntimeError("STT stream is not started")

    def _raise_worker_failure(self) -> None:
        if self._worker is None or not self._worker.done() or self._worker.cancelled():
            return
        failure = self._worker.exception()
        if failure is not None:
            raise failure

    @abstractmethod
    def _transcribe(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> AsyncIterator[str | ProviderSegmentFinal]: ...

    async def _close_provider(self) -> None:
        return None
