import asyncio

from app.runtime import CaptionRuntime


class State:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def mark_degraded(self, error_code: str) -> None:
        self.errors.append(error_code)


def test_runtime_starts_one_consumer_and_stops_gracefully() -> None:
    async def scenario() -> None:
        started = asyncio.Event()
        stopped = asyncio.Event()

        class Consumer:
            async def run(self, stop_event: asyncio.Event) -> None:
                started.set()
                await stop_event.wait()
                stopped.set()

        state = State()
        runtime = CaptionRuntime(
            Consumer(),
            state,
            shutdown_timeout_seconds=1,
            cancel_grace_seconds=1,
        )
        runtime.start()
        await started.wait()
        assert runtime.is_running is True

        await runtime.stop()

        assert stopped.is_set()
        assert runtime.is_running is False
        assert state.errors == []

    asyncio.run(scenario())


def test_runtime_cancels_consumer_after_graceful_deadline() -> None:
    async def scenario() -> None:
        started = asyncio.Event()
        cancelled = asyncio.Event()

        class Consumer:
            async def run(self, stop_event: asyncio.Event) -> None:
                started.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise

        runtime = CaptionRuntime(
            Consumer(),
            State(),
            shutdown_timeout_seconds=0.001,
            cancel_grace_seconds=1,
        )
        runtime.start()
        await started.wait()

        await runtime.stop()

        assert cancelled.is_set()
        assert runtime.is_running is False

    asyncio.run(scenario())


def test_runtime_marks_state_when_consumer_exits_unexpectedly() -> None:
    async def scenario() -> None:
        class Consumer:
            async def run(self, stop_event: asyncio.Event) -> None:
                return

        state = State()
        runtime = CaptionRuntime(
            Consumer(),
            state,
            shutdown_timeout_seconds=1,
            cancel_grace_seconds=1,
        )
        runtime.start()
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        assert state.errors == ["CAPTION_CONSUMER_STOPPED"]
        await runtime.stop()

    asyncio.run(scenario())
