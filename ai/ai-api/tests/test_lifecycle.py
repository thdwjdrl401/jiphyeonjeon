from fastapi.testclient import TestClient

from app import main
from app.config import Settings
from app.main import create_app
from app.runtime import RuntimeState


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

    monkeypatch.setattr(main, "load_settings", lambda: settings)
    monkeypatch.setattr(main, "configure_logging", lambda *_: None)

    def fake_uvicorn_run(_app, **kwargs) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(main.uvicorn, "run", fake_uvicorn_run)

    main.run()

    assert captured == {
        "host": "127.0.0.1",
        "port": 8010,
        "log_config": None,
    }
