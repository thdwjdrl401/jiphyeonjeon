from __future__ import annotations

import asyncio
import math
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager


def _positive_finite(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise TypeError(f"{name} must be a finite number")
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return float(value)


def _non_negative_finite(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise TypeError(f"{name} must be a finite number")
    if value < 0:
        raise ValueError(f"{name} must not be negative")
    return float(value)


class ShutdownDeadline:
    """One absolute budget shared by every post-ROOM_DELETED operation.

    LiveKit starts its own hard cancellation timer when a room disconnects. A
    shared absolute deadline prevents individually bounded operations from
    consuming more than that SDK-wide budget when they run in sequence.
    """

    def __init__(
        self,
        total_seconds: float = 12.0,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._total_seconds = _positive_finite(total_seconds, "total_seconds")
        self._clock = clock
        self._started_at: float | None = None
        self._deadline: float | None = None

    @property
    def started(self) -> bool:
        return self._deadline is not None

    @property
    def deadline(self) -> float | None:
        return self._deadline

    def start(self, started_at_monotonic: float) -> float:
        started_at = _non_negative_finite(started_at_monotonic, "started_at_monotonic")
        if self._started_at is not None:
            if started_at != self._started_at:
                raise RuntimeError("shutdown deadline was already started at another time")
            assert self._deadline is not None
            return self._deadline
        self._started_at = started_at
        self._deadline = started_at + self._total_seconds
        return self._deadline

    def remaining(self) -> float:
        if self._deadline is None:
            raise RuntimeError("shutdown deadline has not started")
        return max(0.0, self._deadline - self._clock())

    @asynccontextmanager
    async def timeout(self, ceiling_seconds: float) -> AsyncIterator[None]:
        ceiling = _positive_finite(ceiling_seconds, "ceiling_seconds")
        remaining = self.remaining()
        if remaining <= 0:
            raise TimeoutError("shared shutdown deadline expired")
        async with asyncio.timeout(min(ceiling, remaining)):
            yield
