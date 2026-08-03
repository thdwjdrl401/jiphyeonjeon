from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Literal

import numpy as np
from app.audio.segmentation import SpeechSegment
from app.stt.engine import (
    AudioChunk,
    EngineCompleted,
    EngineWarning,
    SegmentFinal,
    StreamingSttEngine,
    SttStreamContext,
    TextDelta,
)
from app.stt.providers.segmented import SpeechSegmenter

from stt_lab.audio import PcmAudio

ReplayMode = Literal["accuracy", "paced"]
Clock = Callable[[], float]
Sleeper = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class AudioReplayInput:
    chunks: tuple[AudioChunk, ...]
    source_duration_ms: int
    replay_duration_ms: int
    padded_samples: int


@dataclass(frozen=True)
class SegmentPlanEntry:
    index: int
    start_ms: int
    end_ms: int
    boundary_reason: str
    pcm_sha256: str
    ready_wall_ms: float

    def canonical(self) -> dict[str, str | int]:
        return {
            "index": self.index,
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "boundaryReason": self.boundary_reason,
            "pcmSha256": self.pcm_sha256,
        }


@dataclass(frozen=True)
class EngineEventObservation:
    kind: str
    wall_ms: float
    text: str | None = None
    stream_elapsed_ms: int | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    boundary_reason: str | None = None
    warning_code: str | None = None


@dataclass(frozen=True)
class ReplayExecution:
    stt_session_id: str
    mode: ReplayMode
    source_duration_ms: int
    replay_duration_ms: int
    padded_samples: int
    wall_ms: float
    segment_plan: tuple[SegmentPlanEntry, ...]
    segment_plan_sha256: str
    events: tuple[EngineEventObservation, ...]
    transcript: str


class RecordingSegmenter:
    """Record exactly the SpeechSegments emitted by the product segmenter."""

    def __init__(self, segmenter: SpeechSegmenter, *, clock: Clock = perf_counter) -> None:
        self._segmenter = segmenter
        self._clock = clock
        self._origin_s: float | None = None
        self._entries: list[SegmentPlanEntry] = []

    @property
    def entries(self) -> tuple[SegmentPlanEntry, ...]:
        return tuple(self._entries)

    def begin(self, origin_s: float) -> None:
        if self._origin_s is not None:
            raise RuntimeError("segment observation already started")
        self._origin_s = origin_s

    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        return self._capture(self._segmenter.push(chunk))

    def finish(self) -> list[SpeechSegment]:
        return self._capture(self._segmenter.finish())

    def _capture(self, segments: Sequence[SpeechSegment]) -> list[SpeechSegment]:
        if segments and self._origin_s is None:
            raise RuntimeError("segment observation has not started")
        ready_wall_ms = (
            (self._clock() - self._origin_s) * 1_000 if self._origin_s is not None else 0.0
        )
        for segment in segments:
            self._entries.append(
                SegmentPlanEntry(
                    index=len(self._entries),
                    start_ms=segment.start_ms,
                    end_ms=segment.end_ms,
                    boundary_reason=segment.boundary_reason,
                    pcm_sha256=hashlib.sha256(segment.pcm).hexdigest(),
                    ready_wall_ms=ready_wall_ms,
                )
            )
        return list(segments)


def build_audio_replay(audio: PcmAudio, *, frame_ms: int = 20) -> AudioReplayInput:
    if frame_ms <= 0 or 1_000 % frame_ms:
        raise ValueError("frame_ms must be a positive divisor of 1000")
    frame_samples = audio.sample_rate * frame_ms // 1_000
    if frame_samples <= 0:
        raise ValueError("frame_ms is too small for the sample rate")

    samples = np.asarray(audio.samples, dtype="<i2")
    chunks = tuple(
        AudioChunk(
            pcm=(chunk := samples[offset : offset + frame_samples]).tobytes(),
            sample_rate=audio.sample_rate,
            num_channels=1,
            stream_elapsed_ms=round((offset + chunk.size) * 1_000 / audio.sample_rate),
        )
        for offset in range(0, samples.size, frame_samples)
    )
    return AudioReplayInput(
        chunks=chunks,
        source_duration_ms=audio.duration_ms,
        replay_duration_ms=audio.duration_ms,
        padded_samples=0,
    )


async def run_engine_replay(
    engine: StreamingSttEngine,
    segmenter: RecordingSegmenter,
    replay: AudioReplayInput,
    *,
    stream_id: str,
    language: str,
    mode: ReplayMode,
    clock: Clock = perf_counter,
    sleep: Sleeper = asyncio.sleep,
) -> ReplayExecution:
    if mode not in {"accuracy", "paced"}:
        raise ValueError(f"unsupported replay mode: {mode}")

    started_s = clock()
    segmenter.begin(started_s)
    started = await engine.start_stream(SttStreamContext(stream_id, language))
    event_task = asyncio.create_task(
        _collect_events(engine, origin_s=started_s, clock=clock),
        name=f"stt-lab-events:{stream_id}",
    )
    try:
        for chunk in replay.chunks:
            if mode == "paced":
                target_s = started_s + chunk.stream_elapsed_ms / 1_000
                delay_s = target_s - clock()
                if delay_s > 0:
                    await sleep(delay_s)
            await engine.push_audio(chunk)
        await engine.finish()
        events = await event_task
    except BaseException:
        if not event_task.done():
            event_task.cancel()
        await asyncio.gather(event_task, return_exceptions=True)
        raise
    finally:
        await engine.close()

    wall_ms = (clock() - started_s) * 1_000
    plan = segmenter.entries
    return ReplayExecution(
        stt_session_id=started.stt_session_id,
        mode=mode,
        source_duration_ms=replay.source_duration_ms,
        replay_duration_ms=replay.replay_duration_ms,
        padded_samples=replay.padded_samples,
        wall_ms=wall_ms,
        segment_plan=plan,
        segment_plan_sha256=segment_plan_sha256(plan),
        events=events,
        transcript=" ".join(
            observation.text.strip()
            for observation in events
            if observation.kind == "segmentFinal" and observation.text
        ),
    )


def segment_plan_sha256(entries: Sequence[SegmentPlanEntry]) -> str:
    payload = "".join(
        json.dumps(entry.canonical(), sort_keys=True, separators=(",", ":")) + "\n"
        for entry in entries
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def event_to_dict(event: EngineEventObservation) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            "kind": event.kind,
            "wallMs": event.wall_ms,
            "text": event.text,
            "streamElapsedMs": event.stream_elapsed_ms,
            "startMs": event.start_ms,
            "endMs": event.end_ms,
            "boundaryReason": event.boundary_reason,
            "warningCode": event.warning_code,
        }.items()
        if value is not None
    }


async def _collect_events(
    engine: StreamingSttEngine,
    *,
    origin_s: float,
    clock: Clock,
) -> tuple[EngineEventObservation, ...]:
    observations: list[EngineEventObservation] = []
    async for event in engine.events():
        wall_ms = (clock() - origin_s) * 1_000
        if isinstance(event, TextDelta):
            observation = EngineEventObservation(
                kind="textDelta",
                wall_ms=wall_ms,
                text=event.text,
                stream_elapsed_ms=event.stream_elapsed_ms,
            )
        elif isinstance(event, SegmentFinal):
            observation = EngineEventObservation(
                kind="segmentFinal",
                wall_ms=wall_ms,
                text=event.text,
                start_ms=event.start_stream_elapsed_ms,
                end_ms=event.end_stream_elapsed_ms,
                boundary_reason=event.boundary_reason,
            )
        elif isinstance(event, EngineWarning):
            observation = EngineEventObservation(
                kind="warning",
                wall_ms=wall_ms,
                text=event.message,
                warning_code=event.code,
            )
        elif isinstance(event, EngineCompleted):
            observation = EngineEventObservation(
                kind="completed",
                wall_ms=wall_ms,
                stream_elapsed_ms=event.stream_elapsed_ms,
            )
        else:  # pragma: no cover - EngineEvent is a closed union
            raise TypeError(f"unsupported engine event: {type(event).__name__}")
        observations.append(observation)
    return tuple(observations)
