import asyncio
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class WorkerState:
    ready: bool = False


class WorkerRuntime:
    def __init__(self, state: WorkerState | None = None) -> None:
        self.state = state or WorkerState()

    async def run(self, stop_event: asyncio.Event) -> None:
        self.state.ready = True
        logger.info("ai-worker ready", extra={"event": "service.ready"})
        try:
            await stop_event.wait()
        finally:
            self.state.ready = False
            logger.info("ai-worker stopped", extra={"event": "service.stopped"})
