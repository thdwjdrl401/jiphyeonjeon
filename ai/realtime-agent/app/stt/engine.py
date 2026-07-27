from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
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

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise ValueError("sample_rate must be positive")
        if self.num_channels <= 0:
            raise ValueError("num_channels must be positive")
        if self.stream_elapsed_ms < 0:
            raise ValueError("stream_elapsed_ms must not be negative")


@dataclass(frozen=True, slots=True)
class TextDelta:
    text: str
    stream_elapsed_ms: int


@dataclass(frozen=True, slots=True)
class EngineWarning:
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class EngineCompleted:
    stream_elapsed_ms: int


EngineEvent = TextDelta | EngineWarning | EngineCompleted


class StreamingSttEngine(Protocol):
    @property
    def capabilities(self) -> EngineCapabilities: ...

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted: ...

    async def push_audio(self, chunk: AudioChunk) -> None: ...

    def events(self) -> AsyncIterator[EngineEvent]: ...

    async def finish(self) -> None: ...

    async def close(self) -> None: ...
