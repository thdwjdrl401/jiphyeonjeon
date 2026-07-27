import asyncio
import logging
import signal

import uvicorn

from app.config import Settings, load_settings
from app.logging_config import configure_logging
from app.management import create_management_app
from app.runtime import WorkerState
from app.wiring import build_worker_runtime

logger = logging.getLogger(__name__)


def make_stop_handler(stop_event: asyncio.Event, server: uvicorn.Server):
    def request_stop() -> None:
        logger.info("ai-worker stop requested", extra={"event": "service.stop_requested"})
        stop_event.set()
        server.should_exit = True

    return request_stop


def register_signal_handlers(loop: asyncio.AbstractEventLoop, request_stop) -> None:
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signal_name, request_stop)
        except (NotImplementedError, RuntimeError):
            pass


async def run_worker(settings: Settings) -> None:
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    state = WorkerState()
    runtime = build_worker_runtime(settings, state)
    management_app = create_management_app(state)
    server = uvicorn.Server(
        uvicorn.Config(
            management_app,
            host=settings.management_host,
            port=settings.management_port,
            log_config=None,
        )
    )
    request_stop = make_stop_handler(stop_event, server)
    register_signal_handlers(loop, request_stop)

    runtime_task = asyncio.create_task(runtime.run(stop_event))
    server_task = asyncio.create_task(server.serve())
    tasks = (runtime_task, server_task)
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        stop_event.set()
        server.should_exit = True
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                raise result
    finally:
        stop_event.set()
        server.should_exit = True
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def run() -> None:
    settings = load_settings()
    configure_logging("ai-worker", settings.log_level)
    logger.info(
        "ai-worker starting",
        extra={"event": "service.starting", "worker_id": settings.instance_id},
    )
    asyncio.run(run_worker(settings))


if __name__ == "__main__":
    run()
