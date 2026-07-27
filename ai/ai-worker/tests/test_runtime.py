import asyncio
from unittest.mock import AsyncMock

from app.runtime import WorkerRuntime, WorkerState


async def test_worker_becomes_ready_and_stops_cleanly() -> None:
    state = WorkerState()
    runtime = WorkerRuntime(state)
    stop_event = asyncio.Event()

    task = asyncio.create_task(runtime.run(stop_event))
    await asyncio.sleep(0)
    assert state.ready is True

    stop_event.set()
    await task

    assert state.ready is False


async def test_worker_cancellation_clears_readiness() -> None:
    state = WorkerState()
    runtime = WorkerRuntime(state)
    task = asyncio.create_task(runtime.run(asyncio.Event()))
    await asyncio.sleep(0)

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    assert state.ready is False


async def test_worker_delegates_to_consumer_and_closes_owned_resources() -> None:
    state = WorkerState()
    stop_event = asyncio.Event()

    async def run_consumer(event: asyncio.Event) -> None:
        state.ready = True
        await event.wait()

    runner = type("Runner", (), {"run": AsyncMock(side_effect=run_consumer)})()
    close = AsyncMock()
    runtime = WorkerRuntime(state, runner=runner, close=close)

    task = asyncio.create_task(runtime.run(stop_event))
    while not state.ready:
        await asyncio.sleep(0)
    stop_event.set()
    await task

    runner.run.assert_awaited_once_with(stop_event)
    close.assert_awaited_once_with()
    assert state.ready is False
