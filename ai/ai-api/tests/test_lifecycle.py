from fastapi.testclient import TestClient
from types import SimpleNamespace

from app import main
from app.config import Settings
from app.main import create_app
from app.runtime import RuntimeState
from app.rag import RagAnswerService, RetrievalResult


def test_health_and_readiness_follow_application_lifecycle() -> None:
    runtime = RuntimeState()
    app = create_app(Settings(), runtime)

    assert runtime.ready is False
    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"status": "ok", "service": "ai-api"}
        assert client.get("/readyz").json() == {"status": "ready", "service": "ai-api"}
        assert runtime.ready is True
    assert runtime.ready is False


def test_readiness_is_unavailable_before_startup() -> None:
    runtime = RuntimeState()
    app = create_app(Settings(), runtime)

    with TestClient(app, raise_server_exceptions=True) as client:
        runtime.ready = False
        response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"


def test_run_preserves_structured_logging(monkeypatch) -> None:
    captured: dict[str, object] = {}
    settings = Settings()
    rag_services = _fake_rag_services()
    lecture_note_services = _fake_lecture_note_services()

    monkeypatch.setattr(main, "load_settings", lambda: settings)
    monkeypatch.setattr(main, "configure_logging", lambda *_: None)
    monkeypatch.setattr(main, "build_rag_services", lambda _: rag_services)
    monkeypatch.setattr(main, "build_lecture_note_services", lambda _: lecture_note_services)

    def fake_uvicorn_run(_app, **kwargs) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(main.uvicorn, "run", fake_uvicorn_run)

    main.run()

    assert captured == {
        "host": "127.0.0.1",
        "port": 8010,
        "log_config": None,
    }


def test_rag_resources_follow_application_lifespan() -> None:
    resources = _fake_rag_services()
    app = create_app(Settings(), rag_services=resources)

    assert resources.closed is False
    with TestClient(app):
        assert app.state.caption_runtime.is_running is True
        assert resources.closed is False

    assert app.state.caption_runtime.is_running is False
    assert resources.closed is True


def test_lecture_note_resources_follow_application_lifespan() -> None:
    resources = _fake_lecture_note_services()
    app = create_app(Settings(), lecture_note_services=resources)

    assert resources.closed is False
    with TestClient(app):
        assert app.state.lecture_note_runtime.is_running is True
        assert resources.closed is False

    assert app.state.lecture_note_runtime.is_running is False
    assert resources.closed is True


def test_create_app_rejects_two_rag_service_owners() -> None:
    resources = _fake_rag_services()

    try:
        create_app(Settings(), rag_service=resources.service, rag_services=resources)
    except ValueError as error:
        assert "not both" in str(error)
    else:
        raise AssertionError("create_app accepted two RAG service owners")


def _fake_rag_services():
    class Retriever:
        async def retrieve(self, request):
            return RetrievalResult(sufficient=False)

    class Model:
        def stream_answer(self, request, evidence):
            async def generate():
                if False:
                    yield "unreachable"

            return generate()

    class ConsumerState:
        def mark_degraded(self, error_code: str) -> None:
            self.error_code = error_code

    class Consumer:
        async def run(self, stop_event) -> None:
            await stop_event.wait()

    class Resources:
        def __init__(self) -> None:
            self.service = RagAnswerService(Retriever(), Model())
            self.context = SimpleNamespace(
                consumer=Consumer(),
                consumer_state=ConsumerState(),
            )
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    return Resources()


def _fake_lecture_note_services():
    class ConsumerState:
        def mark_degraded(self, error_code: str) -> None:
            self.error_code = error_code

    class Consumer:
        async def run(self, stop_event) -> None:
            await stop_event.wait()

    class Resources:
        def __init__(self) -> None:
            self.consumer = Consumer()
            self.consumer_state = ConsumerState()
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    return Resources()
