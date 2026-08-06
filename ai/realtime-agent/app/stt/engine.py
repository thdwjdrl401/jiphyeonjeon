from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class SttStreamContext:
    stream_id: str
    language: str = "ko-KR"

    def __post_init__(self) -> None:
        if not self.stream_id.strip():
            raise ValueError("stream_id must not be blank")


@dataclass(frozen=True, slots=True)
class EngineCapabilities:
    sample_rate: int
    num_channels: int = 1
    incremental_deltas: bool = True

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise ValueError("sample_rate must be positive")
        if self.num_channels <= 0:
            raise ValueError("num_channels must be positive")


@dataclass(frozen=True, slots=True)
class SttStreamStarted:
    stt_session_id: str


@dataclass(frozen=True, slots=True)
class AudioChunk:
    pcm: bytes
    sample_rate: int
    num_channels: int
    stream_elapsed_ms: int
    audio_started_at: datetime | None = None

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise ValueError("sample_rate must be positive")
        if self.num_channels <= 0:
            raise ValueError("num_channels must be positive")
        if self.stream_elapsed_ms < 0:
            raise ValueError("stream_elapsed_ms must not be negative")
        if self.audio_started_at is not None:
            if not isinstance(self.audio_started_at, datetime):
                raise TypeError("audio_started_at must be a datetime")
            if self.audio_started_at.utcoffset() is None:
                raise ValueError("audio_started_at must be a timezone-aware datetime")


@dataclass(frozen=True, slots=True)
class TextDelta:
    text: str
    stream_elapsed_ms: int


@dataclass(frozen=True, slots=True)
class EngineWarning:
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class SegmentFinal:
    text: str
    start_stream_elapsed_ms: int
    end_stream_elapsed_ms: int
    boundary_reason: str
    # True when this text already left the engine as TextDelta events. The caption
    # mapper then publishes the final without re-sending the text as a delta, which
    # would duplicate it for delta consumers when one segment yields several finals.
    text_already_delivered: bool = False

    def __post_init__(self) -> None:
        if not self.text:
            raise ValueError("text must not be empty")
        if not isinstance(self.text_already_delivered, bool):
            raise TypeError("text_already_delivered must be a boolean")
        if self.start_stream_elapsed_ms < 0:
            raise ValueError("start_stream_elapsed_ms must not be negative")
        if self.end_stream_elapsed_ms < self.start_stream_elapsed_ms:
            raise ValueError("end_stream_elapsed_ms must not precede start_stream_elapsed_ms")
        if self.boundary_reason not in {"SILENCE", "MAX_DURATION", "STREAM_END"}:
            raise ValueError("unsupported segment boundary_reason")


@dataclass(frozen=True, slots=True)
class EngineCompleted:
    stream_elapsed_ms: int


EngineEvent = TextDelta | SegmentFinal | EngineWarning | EngineCompleted


class StreamingSttEngine(Protocol):
    @property
    def capabilities(self) -> EngineCapabilities: ...

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted: ...

    async def push_audio(self, chunk: AudioChunk) -> None: ...

    def events(self) -> AsyncIterator[EngineEvent]: ...

    async def finish(self) -> None: ...

    async def close(self) -> None: ...
