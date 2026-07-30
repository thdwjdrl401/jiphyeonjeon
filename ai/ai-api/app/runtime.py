from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)


@dataclass
class RuntimeState:
    ready: bool = False


class CaptionConsumer(Protocol):
    async def run(self, stop_event: asyncio.Event) -> None: ...


class CaptionState(Protocol):
    def mark_degraded(self, error_code: str) -> None: ...


class CaptionRuntime:
    """Own exactly one Redis caption consumer task for an application lifespan."""

    def __init__(
        self,
        consumer: CaptionConsumer,
        state: CaptionState,
        *,
        shutdown_timeout_seconds: float,
        cancel_grace_seconds: float,
        task_name: str = "caption-consumer",
    ) -> None:
        if min(shutdown_timeout_seconds, cancel_grace_seconds) <= 0:
            raise ValueError("caption shutdown deadlines must be positive")
        if not task_name or task_name != task_name.strip():
            raise ValueError("consumer task name must be non-empty and unpadded")
        self._consumer = consumer
        self._state = state
        self._shutdown_timeout_seconds = shutdown_timeout_seconds
        self._cancel_grace_seconds = cancel_grace_seconds
        self._task_name = task_name
        self._stop_event: asyncio.Event | None = None
        self._task: asyncio.Task[None] | None = None

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if self._task is not None:
            raise RuntimeError("caption runtime can only be started once")
        stop_event = asyncio.Event()
        task = asyncio.create_task(self._consumer.run(stop_event), name=self._task_name)
        task.add_done_callback(lambda completed: self._observe_task(completed, stop_event))
        self._stop_event = stop_event
        self._task = task

    async def stop(self) -> None:
        task = self._task
        stop_event = self._stop_event
        if task is None or stop_event is None:
            return
        stop_event.set()
        if not await _wait_until_done(task, self._shutdown_timeout_seconds):
            task.cancel()
            if not await _wait_until_done(task, self._cancel_grace_seconds):
                self._state.mark_degraded("CAPTION_CONSUMER_SHUTDOWN_TIMEOUT")
                logger.error(
                    "caption consumer ignored cancellation deadline",
                    extra={
                        "event": "caption.consumer_shutdown_timeout",
                        "error_code": "CAPTION_CONSUMER_SHUTDOWN_TIMEOUT",
                    },
                )
                raise TimeoutError("caption consumer did not stop before the deadline")
        self._task = None
        self._stop_event = None

    def _observe_task(
        self,
        task: asyncio.Task[None],
        stop_event: asyncio.Event,
    ) -> None:
        if task.cancelled():
            return
        exception = task.exception()
        if stop_event.is_set():
            if exception is not None:
                logger.error(
                    "caption consumer stopped with an exception",
                    extra={
                        "event": "caption.consumer_task_failed",
                        "error_code": type(exception).__name__,
                    },
                )
            return
        error_code = "CAPTION_CONSUMER_STOPPED" if exception is None else type(exception).__name__
        self._state.mark_degraded(error_code)
        logger.error(
            "caption consumer task exited unexpectedly",
            extra={
                "event": "caption.consumer_task_exited",
                "error_code": error_code,
            },
        )


async def _wait_until_done(task: asyncio.Task[None], timeout_seconds: float) -> bool:
    done, _ = await asyncio.wait({task}, timeout=timeout_seconds)
    return bool(done)
