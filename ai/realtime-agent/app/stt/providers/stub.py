from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from uuid import uuid4

from app.stt.engine import (
    AudioChunk,
    EngineCapabilities,
    EngineCompleted,
    EngineEvent,
    SttStreamContext,
    SttStreamStarted,
    TextDelta,
)

_CLOSED = object()


class StubStreamingEngine:
    """Test/dev engine with deterministic delta behavior; never a production provider."""

    def __init__(
        self,
        delta: str = "[stub]",
        *,
        session_id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._delta = delta
        self._session_id_factory = session_id_factory or (lambda: uuid4().hex)
        self._queue: asyncio.Queue[EngineEvent | object] = asyncio.Queue()
        self._started = False
        self._finished = False
        self._closed = False
        self._events_taken = False
        self._last_stream_elapsed_ms = 0

    @property
    def started(self) -> bool:
        return self._started and not self._closed

    @property
    def capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(sample_rate=48_000)

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted:
        if self._closed:
            raise RuntimeError("stub engine is closed")
        if self._started:
            raise RuntimeError("stub stream already started")
        self._started = True
        return SttStreamStarted(self._session_id_factory())

    async def push_audio(self, chunk: AudioChunk) -> None:
        self._require_active()
        self._last_stream_elapsed_ms = chunk.stream_elapsed_ms
        await self._queue.put(TextDelta(self._delta, chunk.stream_elapsed_ms))

    async def events(self) -> AsyncIterator[EngineEvent]:
        if not self._started:
            raise RuntimeError("stub stream is not started")
        if self._events_taken:
            raise RuntimeError("stub events can only be consumed once")
        self._events_taken = True
        while True:
            event = await self._queue.get()
            if event is _CLOSED:
                return
            assert isinstance(event, (TextDelta, EngineCompleted))
            yield event
            if isinstance(event, EngineCompleted):
                return

    async def finish(self) -> None:
        self._require_active()
        self._finished = True
        await self._queue.put(EngineCompleted(self._last_stream_elapsed_ms))

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._started = False
        await self._queue.put(_CLOSED)

    def _require_active(self) -> None:
        if self._closed:
            raise RuntimeError("stub engine is closed")
        if self._finished:
            raise RuntimeError("stub stream is already finished")
        if not self._started:
            raise RuntimeError("stub stream is not started")
