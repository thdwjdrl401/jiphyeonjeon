import asyncio

import pytest

from app import main
from app.config import Settings
from app.runtime import WorkerRuntime


DATABASE_URL = "postgresql+asyncpg://ai:secret@localhost/liveclass"


def settings() -> Settings:
    return Settings(instance_id="worker-1", database_url=DATABASE_URL)


class FakeServer:
    instances = []

    def __init__(self, _config=None) -> None:
        self.should_exit = False
        self.started = asyncio.Event()
        self.stopped = asyncio.Event()
        self.instances.append(self)

    async def serve(self) -> None:
        self.started.set()
        try:
            while not self.should_exit:
                await asyncio.sleep(0)
        finally:
            self.stopped.set()


class FakeLoop:
    def __init__(self) -> None:
        self.handlers = []

    def add_signal_handler(self, signal_name, callback) -> None:
        self.handlers.append((signal_name, callback))


def test_stop_handler_requests_worker_and_management_shutdown() -> None:
    stop_event = asyncio.Event()
    server = FakeServer()

    main.make_stop_handler(stop_event, server)()

    assert stop_event.is_set()
    assert server.should_exit is True


def test_registers_sigint_and_sigterm_handlers() -> None:
    loop = FakeLoop()

    main.register_signal_handlers(loop, lambda: None)

    assert len(loop.handlers) == 2


async def test_runtime_failure_stops_management_server(monkeypatch) -> None:
    class FailingRuntime:
        def __init__(self, state) -> None:
            self.state = state

        async def run(self, _stop_event) -> None:
            self.state.ready = True
            try:
                raise RuntimeError("runtime failed")
            finally:
                self.state.ready = False

    FakeServer.instances.clear()
    monkeypatch.setattr(
        main,
        "build_worker_runtime",
        lambda _settings, state: FailingRuntime(state),
    )
    monkeypatch.setattr(main.uvicorn, "Server", FakeServer)

    with pytest.raises(RuntimeError, match="runtime failed"):
        await main.run_worker(settings())

    assert FakeServer.instances[-1].should_exit is True
    assert FakeServer.instances[-1].stopped.is_set()


async def test_management_server_failure_stops_runtime(monkeypatch) -> None:
    states = []

    class FailingServer(FakeServer):
        async def serve(self) -> None:
            self.started.set()
            try:
                raise RuntimeError("management server failed")
            finally:
                self.stopped.set()

    def create_runtime(_settings, state):
        states.append(state)
        return WorkerRuntime(state)

    FailingServer.instances.clear()
    monkeypatch.setattr(main, "build_worker_runtime", create_runtime)
    monkeypatch.setattr(main.uvicorn, "Server", FailingServer)

    with pytest.raises(RuntimeError, match="management server failed"):
        await main.run_worker(settings())

    assert states[-1].ready is False
    assert FailingServer.instances[-1].stopped.is_set()


async def test_cancellation_cleans_up_runtime_and_management_server(monkeypatch) -> None:
    states = []

    def create_runtime(_settings, state):
        states.append(state)
        return WorkerRuntime(state)

    FakeServer.instances.clear()
    monkeypatch.setattr(main, "build_worker_runtime", create_runtime)
    monkeypatch.setattr(main.uvicorn, "Server", FakeServer)

    task = asyncio.create_task(main.run_worker(settings()))
    while not FakeServer.instances or not FakeServer.instances[-1].started.is_set():
        await asyncio.sleep(0)
    await asyncio.sleep(0)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert states[-1].ready is False
    assert FakeServer.instances[-1].stopped.is_set()
