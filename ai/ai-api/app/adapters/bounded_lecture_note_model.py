from __future__ import annotations

import asyncio
import logging
import random
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from time import perf_counter
from typing import Literal, Protocol

from openai import APIConnectionError, APIStatusError, APITimeoutError

from app.lecture_notes import (
    LectureNoteDraftModelRequest,
    LectureNoteDraftUpdateResult,
    LectureNoteModelRequest,
    LectureNoteModelResult,
    LectureNoteRefinementRequest,
    LectureNoteRefinementResult,
)

logger = logging.getLogger(__name__)

_CallKind = Literal["live", "refinement"]
_RETRYABLE_STATUS_CODES = frozenset({408, 409, 429, 500, 502, 503, 504})


class _LectureNoteDelegate(Protocol):
    async def generate(self, request: LectureNoteModelRequest) -> LectureNoteModelResult: ...

    async def generate_draft(
        self,
        request: LectureNoteDraftModelRequest,
    ) -> LectureNoteDraftUpdateResult: ...

    async def refine(
        self,
        request: LectureNoteRefinementRequest,
    ) -> LectureNoteRefinementResult: ...

    async def aclose(self) -> None: ...


@dataclass(slots=True)
class _Waiter:
    kind: _CallKind
    ready: asyncio.Future[None]
    enqueued_at: float
    admitted: bool = False


@dataclass(slots=True)
class _GateMetrics:
    admissions_total: int = 0
    live_admissions_total: int = 0
    refinement_admissions_total: int = 0
    max_in_flight_observed: int = 0
    max_refinement_in_flight_observed: int = 0
    wait_ms_total: float = 0.0
    wait_ms_max: float = 0.0


class _PriorityConcurrencyGate:
    """Bound concurrent calls while preferring live work without starving refinement."""

    def __init__(
        self,
        *,
        max_concurrency: int,
        refinement_max_concurrency: int,
        max_consecutive_live: int,
    ) -> None:
        if min(max_concurrency, refinement_max_concurrency, max_consecutive_live) <= 0:
            raise ValueError("lecture note GMS concurrency limits must be positive")
        if refinement_max_concurrency > max_concurrency:
            raise ValueError("refinement concurrency must not exceed total concurrency")
        self._max_concurrency = max_concurrency
        self._refinement_max_concurrency = refinement_max_concurrency
        self._max_consecutive_live = max_consecutive_live
        self._lock = asyncio.Lock()
        self._live_waiters: deque[_Waiter] = deque()
        self._refinement_waiters: deque[_Waiter] = deque()
        self._in_flight = 0
        self._refinement_in_flight = 0
        self._consecutive_live = 0
        self._metrics = _GateMetrics()
        self._wait_ms_samples: deque[float] = deque(maxlen=10_000)

    @asynccontextmanager
    async def slot(self, kind: _CallKind) -> AsyncIterator[None]:
        await self._acquire(kind)
        try:
            yield
        finally:
            await self._release(kind)

    async def _acquire(self, kind: _CallKind) -> None:
        waiter = _Waiter(
            kind=kind,
            ready=asyncio.get_running_loop().create_future(),
            enqueued_at=perf_counter(),
        )
        async with self._lock:
            self._queue_for(kind).append(waiter)
            self._admit_locked()
        try:
            await waiter.ready
        except BaseException:
            async with self._lock:
                if waiter.admitted:
                    self._release_locked(kind)
                else:
                    self._remove_waiter(waiter)
                self._admit_locked()
            raise

    async def _release(self, kind: _CallKind) -> None:
        async with self._lock:
            self._release_locked(kind)
            self._admit_locked()

    def _release_locked(self, kind: _CallKind) -> None:
        self._in_flight -= 1
        if kind == "refinement":
            self._refinement_in_flight -= 1
        if self._in_flight < 0 or self._refinement_in_flight < 0:
            raise RuntimeError("lecture note GMS gate released without an active lease")

    def _admit_locked(self) -> None:
        while self._in_flight < self._max_concurrency:
            kind = self._next_kind()
            if kind is None:
                return
            waiter = self._queue_for(kind).popleft()
            waiter.admitted = True
            self._in_flight += 1
            if kind == "live":
                self._consecutive_live += 1
                self._metrics.live_admissions_total += 1
            else:
                self._consecutive_live = 0
                self._refinement_in_flight += 1
                self._metrics.refinement_admissions_total += 1
            wait_ms = (perf_counter() - waiter.enqueued_at) * 1_000
            self._metrics.admissions_total += 1
            self._metrics.wait_ms_total += wait_ms
            self._metrics.wait_ms_max = max(self._metrics.wait_ms_max, wait_ms)
            self._wait_ms_samples.append(wait_ms)
            self._metrics.max_in_flight_observed = max(
                self._metrics.max_in_flight_observed,
                self._in_flight,
            )
            self._metrics.max_refinement_in_flight_observed = max(
                self._metrics.max_refinement_in_flight_observed,
                self._refinement_in_flight,
            )
            waiter.ready.set_result(None)

    def _next_kind(self) -> _CallKind | None:
        refinement_available = bool(self._refinement_waiters) and (
            self._refinement_in_flight < self._refinement_max_concurrency
        )
        if self._live_waiters:
            if refinement_available and self._consecutive_live >= self._max_consecutive_live:
                return "refinement"
            return "live"
        if refinement_available:
            return "refinement"
        return None

    def _queue_for(self, kind: _CallKind) -> deque[_Waiter]:
        return self._live_waiters if kind == "live" else self._refinement_waiters

    def _remove_waiter(self, waiter: _Waiter) -> None:
        try:
            self._queue_for(waiter.kind).remove(waiter)
        except ValueError:
            return

    def metrics_snapshot(self) -> dict[str, int | float]:
        wait_samples = sorted(self._wait_ms_samples)
        return {
            "max_concurrency": self._max_concurrency,
            "refinement_max_concurrency": self._refinement_max_concurrency,
            "in_flight": self._in_flight,
            "refinement_in_flight": self._refinement_in_flight,
            "queued_live": len(self._live_waiters),
            "queued_refinement": len(self._refinement_waiters),
            "admissions_total": self._metrics.admissions_total,
            "live_admissions_total": self._metrics.live_admissions_total,
            "refinement_admissions_total": self._metrics.refinement_admissions_total,
            "max_in_flight_observed": self._metrics.max_in_flight_observed,
            "max_refinement_in_flight_observed": (self._metrics.max_refinement_in_flight_observed),
            "wait_ms_total": self._metrics.wait_ms_total,
            "wait_ms_max": self._metrics.wait_ms_max,
            "wait_ms_p50": _percentile(wait_samples, 0.50),
            "wait_ms_p95": _percentile(wait_samples, 0.95),
        }


class BoundedLectureNoteModel:
    """Priority-aware process-local gate and bounded retry around the GMS adapter."""

    def __init__(
        self,
        delegate: _LectureNoteDelegate,
        *,
        max_concurrency: int = 4,
        refinement_max_concurrency: int = 1,
        max_consecutive_live: int = 8,
        max_attempts: int = 3,
        retry_base_seconds: float = 0.5,
        retry_max_seconds: float = 5.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        jitter: Callable[[], float] = random.random,
    ) -> None:
        if max_attempts <= 0:
            raise ValueError("lecture note GMS max attempts must be positive")
        if min(retry_base_seconds, retry_max_seconds) <= 0:
            raise ValueError("lecture note GMS retry delays must be positive")
        if retry_base_seconds > retry_max_seconds:
            raise ValueError("lecture note GMS retry delays must be ordered")
        self._delegate = delegate
        self._gate = _PriorityConcurrencyGate(
            max_concurrency=max_concurrency,
            refinement_max_concurrency=refinement_max_concurrency,
            max_consecutive_live=max_consecutive_live,
        )
        self._max_attempts = max_attempts
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds
        self._sleep = sleep
        self._jitter = jitter
        self._retries_total = 0
        self._failures_total = 0

    async def generate(self, request: LectureNoteModelRequest) -> LectureNoteModelResult:
        return await self._call_with_retry("live", lambda: self._delegate.generate(request))

    async def generate_draft(
        self,
        request: LectureNoteDraftModelRequest,
    ) -> LectureNoteDraftUpdateResult:
        return await self._call_with_retry(
            "live",
            lambda: self._delegate.generate_draft(request),
        )

    async def refine(
        self,
        request: LectureNoteRefinementRequest,
    ) -> LectureNoteRefinementResult:
        return await self._call_with_retry(
            "refinement",
            lambda: self._delegate.refine(request),
        )

    async def _call_with_retry[T](
        self,
        kind: _CallKind,
        operation: Callable[[], Awaitable[T]],
    ) -> T:
        for attempt in range(1, self._max_attempts + 1):
            try:
                async with self._gate.slot(kind):
                    return await operation()
            except Exception as exc:
                if attempt >= self._max_attempts or not _is_retryable(exc):
                    self._failures_total += 1
                    raise
                self._retries_total += 1
                delay = _retry_delay_seconds(
                    exc,
                    attempt=attempt,
                    base_seconds=self._retry_base_seconds,
                    max_seconds=self._retry_max_seconds,
                    jitter=self._jitter(),
                )
                logger.warning(
                    "강의 노트 GMS 호출 재시도",
                    extra={
                        "event": "lecture_note.gms_retry",
                        "call_kind": kind,
                        "attempt": attempt,
                        "error_code": type(exc).__name__,
                        "delay_seconds": delay,
                    },
                )
                await self._sleep(delay)
        raise RuntimeError("lecture note GMS retry loop exhausted")  # pragma: no cover

    def metrics_snapshot(self) -> dict[str, int | float]:
        return {
            **self._gate.metrics_snapshot(),
            "retries_total": self._retries_total,
            "failures_total": self._failures_total,
        }

    async def aclose(self) -> None:
        await self._delegate.aclose()


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError)):
        return True
    return isinstance(exc, APIStatusError) and exc.status_code in _RETRYABLE_STATUS_CODES


def _retry_delay_seconds(
    exc: Exception,
    *,
    attempt: int,
    base_seconds: float,
    max_seconds: float,
    jitter: float,
) -> float:
    if isinstance(exc, APIStatusError):
        retry_after = exc.response.headers.get("retry-after")
        if retry_after is not None:
            try:
                return min(max_seconds, max(0.0, float(retry_after)))
            except ValueError:
                pass
    exponential = min(max_seconds, base_seconds * (2 ** (attempt - 1)))
    return min(max_seconds, exponential * (0.5 + min(1.0, max(0.0, jitter))))


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    position = fraction * (len(values) - 1)
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    weight = position - lower
    return values[lower] * (1 - weight) + values[upper] * weight
