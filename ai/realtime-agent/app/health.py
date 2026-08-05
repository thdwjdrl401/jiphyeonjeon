from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
from dataclasses import dataclass
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Final, Protocol

_CONTRACT_VERSION: Final = "1"
_SERVICE_NAME: Final = "realtime-agent"
_LIVE_PATH: Final = "/health/live"
_READY_PATH: Final = "/health/ready"


class ConnectionProbe(Protocol):
    def __call__(self) -> bool: ...


def _process_start_time(pid: int) -> str | None:
    """Return Linux /proc starttime so a reused PID cannot satisfy an old marker."""

    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        return None
    _, separator, tail = stat.rpartition(")")
    if not separator:
        return None
    fields_after_command = tail.split()
    if len(fields_after_command) <= 19:
        return None
    return fields_after_command[19]


@dataclass(frozen=True, slots=True)
class ProcessReadinessMarker:
    """Pickle-safe child-process handle for recording completed STT initialization."""

    directory: str

    def mark_current_process_ready(self) -> None:
        pid = os.getpid()
        start_time = _process_start_time(pid)
        if start_time is None:
            raise RuntimeError("cannot identify the initialized STT process")
        directory = Path(self.directory)
        marker = directory / f"{pid}-{start_time}.ready"
        temporary = directory / f".{pid}-{start_time}-{threading.get_native_id()}.tmp"
        temporary.write_text("ready\n", encoding="utf-8")
        os.replace(temporary, marker)


class SttReadinessState:
    def __init__(
        self,
        stt_provider: str,
        expected_process_count: int,
        marker_directory: str | None = None,
    ) -> None:
        if expected_process_count < 1:
            raise ValueError("expected_process_count must be positive")
        self._stt_provider = stt_provider
        self._expected_process_count = expected_process_count
        self._marker_directory = marker_directory or tempfile.mkdtemp(
            prefix="liveclass-stt-readiness-"
        )
        Path(self._marker_directory).mkdir(mode=0o700, parents=True, exist_ok=True)
        self._worker_started = threading.Event()
        self._livekit_connected = threading.Event()
        self._connection_probe: ConnectionProbe | None = None
        self._provider_probe: ConnectionProbe | None = None

    @property
    def process_marker(self) -> ProcessReadinessMarker:
        return ProcessReadinessMarker(self._marker_directory)

    def mark_worker_started(self) -> None:
        self._worker_started.set()

    def mark_livekit_connected(self, *_event_arguments: object) -> None:
        self._livekit_connected.set()

    def set_livekit_connection_probe(self, probe: ConnectionProbe) -> None:
        self._connection_probe = probe

    def set_stt_provider_probe(self, probe: ConnectionProbe) -> None:
        self._provider_probe = probe

    def liveness_payload(self) -> dict[str, object]:
        return {
            "contractVersion": _CONTRACT_VERSION,
            "status": "alive",
            "service": _SERVICE_NAME,
        }

    def readiness_payload(self) -> dict[str, object]:
        ready_process_count = self._ready_process_count()
        models_ready = (
            ready_process_count >= self._expected_process_count and self._provider_is_healthy()
        )
        worker_started = self._worker_started.is_set()
        livekit_connected = self._livekit_connected.is_set() and self._connection_is_healthy()
        ready = models_ready and worker_started and livekit_connected
        return {
            "contractVersion": _CONTRACT_VERSION,
            "status": "ready" if ready else "notReady",
            "service": _SERVICE_NAME,
            "sttProvider": self._stt_provider,
            "workerStarted": worker_started,
            "liveKitConnected": livekit_connected,
            "modelsReady": models_ready,
            "readyProcessCount": ready_process_count,
            "expectedProcessCount": self._expected_process_count,
        }

    def close(self) -> None:
        shutil.rmtree(self._marker_directory, ignore_errors=True)

    def _ready_process_count(self) -> int:
        ready_pids: set[int] = set()
        for marker in Path(self._marker_directory).glob("*.ready"):
            try:
                pid_text, start_time = marker.stem.split("-", maxsplit=1)
                pid = int(pid_text)
            except ValueError:
                continue
            if _process_start_time(pid) == start_time:
                ready_pids.add(pid)
        return len(ready_pids)

    def _connection_is_healthy(self) -> bool:
        if self._connection_probe is None:
            return True
        return self._connection_probe()

    def _provider_is_healthy(self) -> bool:
        if self._provider_probe is None:
            return True
        try:
            return self._provider_probe()
        except (OSError, RuntimeError, TypeError, ValueError):
            return False


class _HealthRequestHandler(BaseHTTPRequestHandler):
    server_version = "LiveClassHealth/1"

    def __init__(self, *args: object, state: SttReadinessState, **kwargs: object) -> None:
        self._state = state
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:
        path = self.path.partition("?")[0]
        if path == "/":
            self._write_response(HTTPStatus.OK, b"OK\n", "text/plain; charset=utf-8")
            return
        if path == _LIVE_PATH:
            self._write_json(HTTPStatus.OK, self._state.liveness_payload())
            return
        if path == _READY_PATH:
            payload = self._state.readiness_payload()
            status = (
                HTTPStatus.OK if payload["status"] == "ready" else HTTPStatus.SERVICE_UNAVAILABLE
            )
            self._write_json(status, payload)
            return
        self._write_json(
            HTTPStatus.NOT_FOUND,
            {"contractVersion": _CONTRACT_VERSION, "status": "notFound"},
        )

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _write_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        body = (json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
        self._write_response(status, body, "application/json; charset=utf-8")

    def _write_response(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


class _HealthHttpServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class SttHealthServer:
    def __init__(self, host: str, port: int, state: SttReadinessState) -> None:
        handler = partial(_HealthRequestHandler, state=state)
        self._server = _HealthHttpServer((host, port), handler)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="stt-health-server",
            daemon=True,
        )
        self._state = state

    @property
    def port(self) -> int:
        return int(self._server.server_address[1])

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        if self._thread.is_alive():
            self._server.shutdown()
            self._thread.join(timeout=5)
        self._server.server_close()
        self._state.close()
