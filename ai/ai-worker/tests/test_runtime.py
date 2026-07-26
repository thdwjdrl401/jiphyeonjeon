import asyncio

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
