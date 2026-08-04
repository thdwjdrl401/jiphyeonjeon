from __future__ import annotations

import asyncio
import logging
import signal

import uvicorn

from app.logging_config import configure_logging
from app.management import create_management_app
from app.recorded_stt.config import RecordedSttSettings, load_recorded_stt_settings
from app.recorded_stt.wiring import build_recorded_stt_runtime
from app.runtime import WorkerState

logger = logging.getLogger(__name__)


async def run_worker(settings: RecordedSttSettings) -> None:
    stop_event = asyncio.Event()
    state = WorkerState()
    runtime = build_recorded_stt_runtime(settings, state)
    server = uvicorn.Server(
        uvicorn.Config(
            create_management_app(state),
            host=settings.management_host,
            port=settings.management_port,
            log_config=None,
        )
    )

    def request_stop() -> None:
        stop_event.set()
        server.should_exit = True

    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signal_name, request_stop)
        except (NotImplementedError, RuntimeError):
            pass

    tasks = (asyncio.create_task(runtime.run(stop_event)), asyncio.create_task(server.serve()))
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        request_stop()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                raise result
    finally:
        request_stop()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def run() -> None:
    settings = load_recorded_stt_settings()
    configure_logging("recorded-stt-worker", settings.log_level)
    logger.info(
        "recorded-stt-worker starting",
        extra={"event": "service.starting", "worker_id": settings.instance_id},
    )
    asyncio.run(run_worker(settings))


if __name__ == "__main__":
    run()
