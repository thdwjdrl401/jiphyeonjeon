from __future__ import annotations

import json
import pickle
from http import HTTPStatus
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

from app.health import SttHealthServer, SttReadinessState


def test_readiness_requires_every_model_worker_and_livekit_registration(tmp_path: Path) -> None:
    state = SttReadinessState("nemotron", 1, str(tmp_path / "markers"))
    marker = pickle.loads(pickle.dumps(state.process_marker))

    assert state.liveness_payload() == {
        "contractVersion": "1",
        "status": "alive",
        "service": "realtime-agent",
    }
    assert state.readiness_payload() == {
        "contractVersion": "1",
        "status": "notReady",
        "service": "realtime-agent",
        "sttProvider": "nemotron",
        "workerStarted": False,
        "liveKitConnected": False,
        "modelsReady": False,
        "readyProcessCount": 0,
        "expectedProcessCount": 1,
    }

    marker.mark_current_process_ready()
    model_only = state.readiness_payload()
    assert model_only["modelsReady"] is True
    assert model_only["status"] == "notReady"

    state.mark_worker_started()
    state.mark_livekit_connected("worker-id", object())

    assert state.readiness_payload() == {
        "contractVersion": "1",
        "status": "ready",
        "service": "realtime-agent",
        "sttProvider": "nemotron",
        "workerStarted": True,
        "liveKitConnected": True,
        "modelsReady": True,
        "readyProcessCount": 1,
        "expectedProcessCount": 1,
    }
    state.close()


def test_stale_or_malformed_process_markers_do_not_report_ready(tmp_path: Path) -> None:
    marker_directory = tmp_path / "markers"
    state = SttReadinessState("nemotron", 1, str(marker_directory))
    (marker_directory / "999999999-1.ready").write_text("ready\n", encoding="utf-8")
    (marker_directory / "invalid.ready").write_text("ready\n", encoding="utf-8")
    state.mark_worker_started()
    state.mark_livekit_connected()

    payload = state.readiness_payload()

    assert payload["readyProcessCount"] == 0
    assert payload["modelsReady"] is False
    assert payload["status"] == "notReady"
    state.close()


def test_http_health_contract_uses_200_for_live_and_503_until_ready(tmp_path: Path) -> None:
    state = SttReadinessState("nemotron", 1, str(tmp_path / "markers"))
    server = SttHealthServer("127.0.0.1", 0, state)
    server.start()
    base_url = f"http://127.0.0.1:{server.port}"
    try:
        with urlopen(f"{base_url}/", timeout=2) as response:
            assert response.status == HTTPStatus.OK
            assert response.read() == b"OK\n"

        with urlopen(f"{base_url}/health/live", timeout=2) as response:
            assert response.status == HTTPStatus.OK
            assert json.load(response) == state.liveness_payload()

        try:
            urlopen(f"{base_url}/health/ready", timeout=2)
        except HTTPError as error:
            assert error.code == HTTPStatus.SERVICE_UNAVAILABLE
            assert json.load(error)["status"] == "notReady"
        else:
            raise AssertionError("readiness must return 503 before initialization")

        state.process_marker.mark_current_process_ready()
        state.mark_worker_started()
        state.mark_livekit_connected()
        with urlopen(f"{base_url}/health/ready", timeout=2) as response:
            assert response.status == HTTPStatus.OK
            assert json.load(response)["status"] == "ready"
            assert response.headers["Cache-Control"] == "no-store"
    finally:
        server.close()
