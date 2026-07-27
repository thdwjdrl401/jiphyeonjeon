import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)


@dataclass
class WorkerState:
    ready: bool = False


class WorkerRunner(Protocol):
    async def run(self, stop_event: asyncio.Event) -> None: ...


class WorkerRuntime:
    def __init__(
        self,
        state: WorkerState | None = None,
        *,
        runner: WorkerRunner | None = None,
        close: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.state = state or WorkerState()
        self._runner = runner
        self._close = close

    async def run(self, stop_event: asyncio.Event) -> None:
        try:
            if self._runner is None:
                self.state.ready = True
                logger.info("ai-worker ready", extra={"event": "service.ready"})
                await stop_event.wait()
            else:
                await self._runner.run(stop_event)
        finally:
            self.state.ready = False
            if self._close is not None:
                await self._close()
            logger.info("ai-worker stopped", extra={"event": "service.stopped"})
