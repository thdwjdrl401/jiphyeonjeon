from fastapi.testclient import TestClient

from app.management import create_management_app
from app.runtime import WorkerState


def test_health_is_available_when_worker_is_not_ready() -> None:
    client = TestClient(create_management_app(WorkerState(ready=False)))

    assert client.get("/healthz").json() == {"status": "ok", "service": "ai-worker"}
    assert client.get("/readyz").status_code == 503


def test_readiness_exposes_worker_state() -> None:
    state = WorkerState(ready=True)
    client = TestClient(create_management_app(state))

    assert client.get("/readyz").json() == {"status": "ready", "service": "ai-worker"}

    state.ready = False
    assert client.get("/readyz").json()["status"] == "not_ready"
