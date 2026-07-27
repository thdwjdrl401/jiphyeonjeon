from __future__ import annotations

import audioop

from app.stt.engine import AudioChunk

RatecvState = tuple[int, tuple[tuple[int, int], ...]]


class Pcm16Normalizer:
    """Normalize one PCM16 stream to mono at a fixed sample rate."""

    __slots__ = ("_rate_state", "_source_rate", "_target_rate")

    def __init__(self, target_rate: int = 16_000) -> None:
        if target_rate <= 0:
            raise ValueError("target_rate must be positive")
        self._target_rate = target_rate
        self._source_rate: int | None = None
        self._rate_state: RatecvState | None = None

    @property
    def target_rate(self) -> int:
        return self._target_rate

    def normalize(self, chunk: AudioChunk) -> bytes:
        pcm = chunk.pcm
        if chunk.num_channels not in (1, 2):
            raise ValueError(f"unsupported channel count: {chunk.num_channels}")
        if len(pcm) % (2 * chunk.num_channels) != 0:
            raise ValueError("incomplete PCM16 frame")

        if chunk.num_channels == 2:
            pcm = audioop.tomono(pcm, 2, 0.5, 0.5)

        if self._source_rate is None:
            self._source_rate = chunk.sample_rate
        elif chunk.sample_rate != self._source_rate:
            raise ValueError(
                f"source sample rate changed: {self._source_rate} -> {chunk.sample_rate}"
            )

        if chunk.sample_rate != self._target_rate:
            pcm, self._rate_state = audioop.ratecv(
                pcm,
                2,
                1,
                chunk.sample_rate,
                self._target_rate,
                self._rate_state,
            )
        return pcm
