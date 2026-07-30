from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from importlib import import_module
from typing import Literal, Protocol, cast

from app.audio.normalizer import Pcm16Normalizer
from app.stt.engine import AudioChunk

_VALID_SAMPLE_RATES = frozenset({8_000, 16_000, 32_000, 48_000})
_VALID_FRAME_DURATIONS_MS = frozenset({10, 20, 30})


SegmentBoundaryReason = Literal["SILENCE", "MAX_DURATION", "STREAM_END"]


class VoiceActivityDetector(Protocol):
    def is_speech(self, frame: bytes, sample_rate: int) -> bool: ...


@dataclass(frozen=True, slots=True)
class SpeechSegment:
    pcm: bytes
    sample_rate: int
    start_ms: int
    end_ms: int
    boundary_reason: SegmentBoundaryReason = "SILENCE"


@dataclass(frozen=True, slots=True)
class _VadFrame:
    pcm: bytes
    is_speech: bool


class VadSegmenter:
    """Build bounded PCM16 speech segments on a normalized audio clock."""

    def __init__(
        self,
        sample_rate: int = 16_000,
        frame_ms: int = 20,
        pad_ms: int = 200,
        min_speech_ms: int = 300,
        max_speech_ms: int = 8_000,
        silence_close_ms: int = 500,
        *,
        vad: VoiceActivityDetector | None = None,
    ) -> None:
        self._validate_policy(
            sample_rate,
            frame_ms,
            pad_ms,
            min_speech_ms,
            max_speech_ms,
            silence_close_ms,
        )
        self.sample_rate = sample_rate
        self._frame_ms = frame_ms
        self._frame_bytes = sample_rate * frame_ms // 1_000 * 2
        self._pad_frames = pad_ms // frame_ms
        self._min_speech_ms = min_speech_ms
        self._max_speech_ms = max_speech_ms
        self._silence_close_ms = silence_close_ms
        self._vad = vad if vad is not None else self._load_default_vad()
        self._normalizer = Pcm16Normalizer(sample_rate)
        self._buffer = b""
        self._preroll: deque[_VadFrame] = deque(maxlen=self._pad_frames)
        self._frames: list[_VadFrame] = []
        self._active = False
        self._elapsed_ms = 0
        self._speech_start_ms = 0
        self._speech_end_ms = 0
        self._speech_ms = 0
        self._silence_ms = 0

    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        self._buffer += self._normalizer.normalize(chunk)
        completed: list[SpeechSegment] = []
        while len(self._buffer) >= self._frame_bytes:
            frame = self._buffer[: self._frame_bytes]
            self._buffer = self._buffer[self._frame_bytes :]
            completed.extend(self._process(frame))
        return completed

    def finish(self) -> list[SpeechSegment]:
        completed: list[SpeechSegment] = []
        if self._active and self._speech_ms >= self._min_speech_ms:
            completed.append(self._flush("STREAM_END", preserve_preroll=False))
        else:
            self._reset_active(preserve_preroll=False)
        self._buffer = b""
        self._preroll.clear()
        return completed

    def _process(self, pcm: bytes) -> list[SpeechSegment]:
        frame = _VadFrame(pcm, self._vad.is_speech(pcm, self.sample_rate))
        self._elapsed_ms += self._frame_ms

        if not self._active:
            if not frame.is_speech:
                self._preroll.append(frame)
                return []
            self._activate(frame)
        else:
            self._frames.append(frame)
            if frame.is_speech:
                self._speech_ms += self._frame_ms
                self._silence_ms = 0
                self._speech_end_ms = self._elapsed_ms
            else:
                self._silence_ms += self._frame_ms

        if len(self._frames) * self._frame_ms >= self._max_speech_ms:
            # Provider output is append-only, so replaying speech overlap at a forced
            # boundary would duplicate captions. The next frame starts a contiguous
            # segment instead.
            if self._speech_ms >= self._min_speech_ms:
                return [self._flush("MAX_DURATION", preserve_preroll=False)]
            self._reset_active(preserve_preroll=False)
            return []
        if self._silence_ms >= self._silence_close_ms:
            return self._close_if_long_enough()
        return []

    def _activate(self, frame: _VadFrame) -> None:
        self._active = True
        self._frames = [*self._preroll, frame]
        self._preroll.clear()
        self._speech_start_ms = self._elapsed_ms - self._frame_ms
        self._speech_end_ms = self._elapsed_ms
        self._speech_ms = sum(item.is_speech for item in self._frames) * self._frame_ms
        self._silence_ms = 0

    def _close_if_long_enough(self) -> list[SpeechSegment]:
        if self._speech_ms >= self._min_speech_ms:
            return [self._flush("SILENCE", preserve_preroll=True)]
        self._reset_active(preserve_preroll=True)
        return []

    def _flush(
        self,
        boundary_reason: SegmentBoundaryReason,
        *,
        preserve_preroll: bool,
    ) -> SpeechSegment:
        segment = SpeechSegment(
            pcm=b"".join(frame.pcm for frame in self._frames),
            sample_rate=self.sample_rate,
            start_ms=self._speech_start_ms,
            end_ms=self._speech_end_ms,
            boundary_reason=boundary_reason,
        )
        self._reset_active(preserve_preroll=preserve_preroll)
        return segment

    def _reset_active(self, *, preserve_preroll: bool) -> None:
        if preserve_preroll and self._pad_frames:
            self._preroll.extend(self._frames[-self._pad_frames :])
        else:
            self._preroll.clear()
        self._frames = []
        self._active = False
        self._speech_ms = 0
        self._silence_ms = 0

    @staticmethod
    def _load_default_vad() -> VoiceActivityDetector:
        try:
            module = import_module("webrtcvad")
        except ModuleNotFoundError as exc:
            if exc.name != "webrtcvad":
                raise
            raise RuntimeError(
                "webrtcvad is required when no voice activity detector is provided"
            ) from exc
        return cast(VoiceActivityDetector, module.Vad(2))

    @staticmethod
    def _validate_policy(
        sample_rate: int,
        frame_ms: int,
        pad_ms: int,
        min_speech_ms: int,
        max_speech_ms: int,
        silence_close_ms: int,
    ) -> None:
        if sample_rate not in _VALID_SAMPLE_RATES:
            raise ValueError("sample_rate must be supported by WebRTC VAD")
        if frame_ms not in _VALID_FRAME_DURATIONS_MS:
            raise ValueError("frame_ms must be 10, 20, or 30")
        values = {
            "pad_ms": pad_ms,
            "min_speech_ms": min_speech_ms,
            "max_speech_ms": max_speech_ms,
            "silence_close_ms": silence_close_ms,
        }
        for name, value in values.items():
            if value < 0 or value % frame_ms:
                raise ValueError(f"{name} must be a non-negative multiple of frame_ms")
        if min_speech_ms == 0:
            raise ValueError("min_speech_ms must be positive")
        if max_speech_ms < min_speech_ms:
            raise ValueError("max_speech_ms must be at least min_speech_ms")
        if pad_ms >= max_speech_ms:
            raise ValueError("pad_ms must be less than max_speech_ms")
        if silence_close_ms == 0:
            raise ValueError("silence_close_ms must be positive")
