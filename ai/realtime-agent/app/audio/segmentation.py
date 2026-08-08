from __future__ import annotations

import logging
import math
import struct
from collections import deque
from datetime import datetime, timedelta
from dataclasses import dataclass
from importlib import import_module
from typing import Literal, Protocol, cast

from app.audio.normalizer import Pcm16Normalizer
from app.stt.engine import AudioChunk

_VALID_SAMPLE_RATES = frozenset({8_000, 16_000, 32_000, 48_000})
_VALID_FRAME_DURATIONS_MS = frozenset({10, 20, 30})

logger = logging.getLogger(__name__)


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
    # Wall clock of the speech boundaries. `start_ms`/`end_ms` run on the received-audio
    # clock, which excludes silence by design, so they cannot be converted to a session
    # timeline on their own. None when chunks carried no `captured_at`.
    started_at: datetime | None = None
    ended_at: datetime | None = None
    speech_ms: int = 0
    segment_ms: int = 0
    speech_ratio: float = 0.0
    mean_rms_dbfs: float = float("-inf")


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
        activation_ms: int = 20,
        pad_ms: int = 200,
        min_speech_ms: int = 500,
        min_speech_ratio: float = 0.0,
        max_speech_ms: int = 15_000,
        silence_close_ms: int = 500,
        *,
        vad: VoiceActivityDetector | None = None,
    ) -> None:
        self._validate_policy(
            sample_rate,
            frame_ms,
            activation_ms,
            pad_ms,
            min_speech_ms,
            min_speech_ratio,
            max_speech_ms,
            silence_close_ms,
        )
        self.sample_rate = sample_rate
        self._frame_ms = frame_ms
        self._frame_bytes = sample_rate * frame_ms // 1_000 * 2
        self._activation_frames_required = activation_ms // frame_ms
        self._pad_frames = pad_ms // frame_ms
        self._min_speech_ms = min_speech_ms
        self._min_speech_ratio = min_speech_ratio
        self._max_speech_ms = max_speech_ms
        self._silence_close_ms = silence_close_ms
        self._vad = vad if vad is not None else self._load_default_vad()
        self._normalizer = Pcm16Normalizer(sample_rate)
        self._buffer = b""
        self._preroll: deque[_VadFrame] = deque(maxlen=self._pad_frames)
        self._activation_frames: list[_VadFrame] = []
        self._frames: list[_VadFrame] = []
        self._active = False
        self._elapsed_ms = 0
        self._speech_start_ms = 0
        self._speech_end_ms = 0
        self._speech_ms = 0
        self._silence_ms = 0
        # (audio clock, wall clock) pairs, one per chunk. A single running offset would
        # be wrong the moment audio stops arriving: the gap belongs to the wall clock but
        # not to the audio clock, so a boundary from *before* the gap must be resolved
        # against the mark that was current then. Bounded to the longest segment this
        # policy can produce plus its pre-roll — older marks can no longer be referenced.
        self._clock_marks: deque[tuple[int, datetime]] = deque(
            maxlen=max(2, (max_speech_ms + pad_ms) // frame_ms + 2)
        )

    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        if chunk.captured_at is not None:
            self._clock_marks.append((self._elapsed_ms, chunk.captured_at))
        self._buffer += self._normalizer.normalize(chunk)
        completed: list[SpeechSegment] = []
        while len(self._buffer) >= self._frame_bytes:
            frame = self._buffer[: self._frame_bytes]
            self._buffer = self._buffer[self._frame_bytes :]
            completed.extend(self._process(frame))
        return completed

    def finish(self) -> list[SpeechSegment]:
        if self._active:
            completed = self._finalize("STREAM_END", preserve_preroll=False)
        else:
            self._reset_active(preserve_preroll=False)
            completed = []
        self._buffer = b""
        self._preroll.clear()
        return completed

    def _process(self, pcm: bytes) -> list[SpeechSegment]:
        frame = _VadFrame(pcm, self._vad.is_speech(pcm, self.sample_rate))
        self._elapsed_ms += self._frame_ms

        if not self._active:
            if not frame.is_speech:
                self._preroll.extend(self._activation_frames)
                self._activation_frames.clear()
                self._preroll.append(frame)
                return []
            self._activation_frames.append(frame)
            if len(self._activation_frames) < self._activation_frames_required:
                return []
            self._activate()
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
            return self._finalize("MAX_DURATION", preserve_preroll=False)
        if self._silence_ms >= self._silence_close_ms:
            return self._finalize("SILENCE", preserve_preroll=True)
        return []

    def _activate(self) -> None:
        self._active = True
        self._frames = [*self._preroll, *self._activation_frames]
        self._preroll.clear()
        self._speech_start_ms = self._elapsed_ms - (len(self._activation_frames) * self._frame_ms)
        self._speech_end_ms = self._elapsed_ms
        self._speech_ms = sum(item.is_speech for item in self._frames) * self._frame_ms
        self._silence_ms = 0
        self._activation_frames.clear()

    def _finalize(
        self,
        boundary_reason: SegmentBoundaryReason,
        *,
        preserve_preroll: bool,
    ) -> list[SpeechSegment]:
        segment_ms, speech_ratio, mean_rms_dbfs = self._quality()
        rejection_reason = None
        if self._speech_ms < self._min_speech_ms:
            rejection_reason = "MIN_SPEECH"
        elif speech_ratio < self._min_speech_ratio:
            rejection_reason = "SPEECH_RATIO"

        if rejection_reason is not None:
            logger.info(
                "discarded VAD segment: gate=%s speech_ms=%d segment_ms=%d "
                "speech_ratio=%.4f mean_rms_dbfs=%.2f boundary_reason=%s",
                rejection_reason,
                self._speech_ms,
                segment_ms,
                speech_ratio,
                mean_rms_dbfs,
                boundary_reason,
            )
            self._reset_active(preserve_preroll=preserve_preroll)
            return []
        return [
            self._flush(
                boundary_reason,
                preserve_preroll=preserve_preroll,
                segment_ms=segment_ms,
                speech_ratio=speech_ratio,
                mean_rms_dbfs=mean_rms_dbfs,
            )
        ]

    def _quality(self) -> tuple[int, float, float]:
        segment_ms = len(self._frames) * self._frame_ms
        speech_ratio = self._speech_ms / segment_ms if segment_ms else 0.0
        square_sum = 0
        sample_count = 0
        for frame in self._frames:
            if not frame.is_speech:
                continue
            for (sample,) in struct.iter_unpack("<h", frame.pcm):
                square_sum += sample * sample
                sample_count += 1
        if not sample_count or not square_sum:
            return segment_ms, speech_ratio, float("-inf")
        rms = math.sqrt(square_sum / sample_count)
        return segment_ms, speech_ratio, 20 * math.log10(rms / 32_768)

    def _wall_clock_at(self, elapsed_ms: int) -> datetime | None:
        """오디오 시계의 한 지점을 벽시계로 옮긴다. 표식이 없으면 None(짐작하지 않는다).

        같은 청크 안에서는 소리가 끊기지 않으므로, 그 지점을 덮는 <b>가장 최근 표식</b>에서
        경과분을 더하면 된다. 표식보다 이른 지점을 물으면 그 표식으로 되짚는다 — 사이에 공백이
        없었다는 뜻이라 안전하다.
        """
        mark: tuple[int, datetime] | None = None
        for candidate in self._clock_marks:
            if candidate[0] <= elapsed_ms:
                mark = candidate
            else:
                break
        if mark is None:
            mark = self._clock_marks[0] if self._clock_marks else None
        if mark is None:
            return None
        return mark[1] + timedelta(milliseconds=elapsed_ms - mark[0])

    def _flush(
        self,
        boundary_reason: SegmentBoundaryReason,
        *,
        preserve_preroll: bool,
        segment_ms: int,
        speech_ratio: float,
        mean_rms_dbfs: float,
    ) -> SpeechSegment:
        segment = SpeechSegment(
            pcm=b"".join(frame.pcm for frame in self._frames),
            sample_rate=self.sample_rate,
            start_ms=self._speech_start_ms,
            end_ms=self._speech_end_ms,
            boundary_reason=boundary_reason,
            started_at=self._wall_clock_at(self._speech_start_ms),
            ended_at=self._wall_clock_at(self._speech_end_ms),
            speech_ms=self._speech_ms,
            segment_ms=segment_ms,
            speech_ratio=speech_ratio,
            mean_rms_dbfs=mean_rms_dbfs,
        )
        logger.info(
            "accepted VAD segment: speech_ms=%d segment_ms=%d speech_ratio=%.4f "
            "mean_rms_dbfs=%.2f boundary_reason=%s",
            segment.speech_ms,
            segment.segment_ms,
            segment.speech_ratio,
            segment.mean_rms_dbfs,
            segment.boundary_reason,
        )
        self._reset_active(preserve_preroll=preserve_preroll)
        return segment

    def _reset_active(self, *, preserve_preroll: bool) -> None:
        if preserve_preroll and self._pad_frames:
            self._preroll.extend(self._frames[-self._pad_frames :])
        else:
            self._preroll.clear()
        self._frames = []
        self._activation_frames.clear()
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
        # Whisper is prone to producing plausible text for non-speech audio.
        # Use WebRTC VAD's strictest mode so short background noises do not
        # become transcription requests.
        return cast(VoiceActivityDetector, module.Vad(3))

    @staticmethod
    def _validate_policy(
        sample_rate: int,
        frame_ms: int,
        activation_ms: int,
        pad_ms: int,
        min_speech_ms: int,
        min_speech_ratio: float,
        max_speech_ms: int,
        silence_close_ms: int,
    ) -> None:
        if sample_rate not in _VALID_SAMPLE_RATES:
            raise ValueError("sample_rate must be supported by WebRTC VAD")
        if frame_ms not in _VALID_FRAME_DURATIONS_MS:
            raise ValueError("frame_ms must be 10, 20, or 30")
        values = {
            "activation_ms": activation_ms,
            "pad_ms": pad_ms,
            "min_speech_ms": min_speech_ms,
            "max_speech_ms": max_speech_ms,
            "silence_close_ms": silence_close_ms,
        }
        for name, value in values.items():
            if value < 0 or value % frame_ms:
                raise ValueError(f"{name} must be a non-negative multiple of frame_ms")
        if activation_ms == 0 or min_speech_ms == 0:
            raise ValueError("activation_ms and min_speech_ms must be positive")
        if activation_ms > min_speech_ms:
            raise ValueError("activation_ms must not exceed min_speech_ms")
        if isinstance(min_speech_ratio, bool) or not isinstance(min_speech_ratio, int | float):
            raise TypeError("min_speech_ratio must be a number")
        if not math.isfinite(min_speech_ratio) or not 0 <= min_speech_ratio <= 1:
            raise ValueError("min_speech_ratio must be within [0, 1]")
        if max_speech_ms < min_speech_ms:
            raise ValueError("max_speech_ms must be at least min_speech_ms")
        if pad_ms >= max_speech_ms:
            raise ValueError("pad_ms must be less than max_speech_ms")
        if silence_close_ms == 0:
            raise ValueError("silence_close_ms must be positive")
