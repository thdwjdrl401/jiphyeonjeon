from __future__ import annotations

import asyncio
import sys
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Protocol

from app.livekit.audio_source import LiveKitInstructorAudioSource
from app.stt.engine import (
    AudioChunk,
    EngineCompleted,
    EngineWarning,
    StreamingSttEngine,
    SttStreamContext,
    TextDelta,
)


class AudioSource(Protocol):
    async def connect(self) -> None: ...

    def chunks(self) -> AsyncIterator[AudioChunk]: ...

    async def close(self) -> None: ...


AudioSourceFactory = Callable[[Any], AudioSource]
EngineSinkEvent = TextDelta | EngineWarning
EngineEventSink = Callable[[EngineSinkEvent], Awaitable[None]]


async def run_room_job(
    context: Any,
    engine: StreamingSttEngine,
    event_sink: EngineEventSink,
    *,
    audio_source_factory: AudioSourceFactory = LiveKitInstructorAudioSource,
) -> None:
    """Connect one LiveKit room job to one streaming STT engine.

    The LiveKit job id is an AI-internal stream id. Spring dispatch metadata and external caption
    fields intentionally stay outside this boundary until both producers and consumers exist.
    """
    assigned_room_name = context.job.room.name
    job_id = str(context.job.id)
    context.log_context_fields = {
        "room_name": assigned_room_name,
        "job_id": job_id,
        "worker_id": str(context.worker_id),
    }

    source: AudioSource | None = None
    event_task: asyncio.Task[None] | None = None
    audio_task: asyncio.Task[None] | None = None
    finish_task: asyncio.Task[None] | None = None
    finish_requested = asyncio.Event()

    try:
        source = audio_source_factory(context)
        await source.connect()
        connected_room_name = context.room.name
        if assigned_room_name != connected_room_name:
            raise ValueError(
                "assigned room does not match connected room: "
                f"{assigned_room_name} != {connected_room_name}"
            )

        await engine.start_stream(SttStreamContext(stream_id=job_id))
        event_task = asyncio.create_task(
            _consume_engine_events(engine, event_sink, finish_requested)
        )
        audio_task = asyncio.create_task(_pump_audio(source, engine))

        done, _pending = await asyncio.wait(
            {audio_task, event_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if event_task in done:
            await event_task
            raise RuntimeError("STT event stream completed before audio input")

        await audio_task
        finish_task = asyncio.create_task(_finish_engine(engine, finish_requested))
        done, _pending = await asyncio.wait(
            {finish_task, event_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if event_task in done:
            await event_task
            await finish_task
        else:
            await finish_task
            await event_task
    finally:
        active_failure = sys.exception()
        tasks = [task for task in (audio_task, event_task, finish_task) if task is not None]
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        cleanup = []
        if source is not None:
            cleanup.append(source.close())
        cleanup.append(engine.close())
        cleanup_results = await asyncio.gather(*cleanup, return_exceptions=True)
        if active_failure is None:
            cleanup_failures = [
                result for result in cleanup_results if isinstance(result, BaseException)
            ]
            if cleanup_failures:
                raise cleanup_failures[0]


async def _pump_audio(source: AudioSource, engine: StreamingSttEngine) -> None:
    async for chunk in source.chunks():
        await engine.push_audio(chunk)


async def _finish_engine(
    engine: StreamingSttEngine,
    finish_requested: asyncio.Event,
) -> None:
    finish_requested.set()
    await engine.finish()


async def _consume_engine_events(
    engine: StreamingSttEngine,
    event_sink: EngineEventSink,
    finish_requested: asyncio.Event,
) -> None:
    async for event in engine.events():
        if isinstance(event, EngineCompleted):
            if not finish_requested.is_set():
                raise RuntimeError("STT event stream completed before finish was requested")
            return
        await event_sink(event)
    raise RuntimeError("STT event stream ended without completion")
