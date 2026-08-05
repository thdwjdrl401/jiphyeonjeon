from __future__ import annotations

import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest
from livekit import api

from scripts.monitor_caption_stream import format_entry
from scripts.monitor_caption_stream import parse_args as parse_monitor_args
from scripts.probe_livekit_room import ProbeSettings, format_room_snapshot

TUNNEL_SCRIPT = Path(__file__).parents[1] / "scripts" / "start_ec2_tunnels.sh"
DEPLOY_DIR = Path(__file__).parents[1] / "deploy"
DEPLOY_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-realtime-agent-deploy"
SUPERVISOR_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-realtime-agent-supervisor"
VLLM_BOOTSTRAP_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-whisper-vllm-bootstrap"
VLLM_SUPERVISOR_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-whisper-vllm-supervisor"
NEMO_SUPERVISOR_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-nemotron-nemo-supervisor"
NEMO_RUNTIME_SERVER = DEPLOY_DIR / "runtime" / "nemotron_nemo_server.py"
RUNNER_CONTROL_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-gitlab-runner-user"
INSTALL_SCRIPT = DEPLOY_DIR / "install.sh"
RUNNER_INSTALL_SCRIPT = DEPLOY_DIR / "install-gitlab-runner-user.sh"
DNS_REDIRECT_SOURCE = DEPLOY_DIR / "livekit-tunnel-dns.c"
TUNNEL_CONFIGURE_SCRIPT = DEPLOY_DIR / "configure-gpu-ec2-tunnels.sh"
COMMON_AGENT_ENV_EXAMPLE = DEPLOY_DIR / "env" / "realtime-agent-common.env.example"
PROD_AGENT_ENV_EXAMPLE = DEPLOY_DIR / "env" / "realtime-agent.env.example"
DEV_AGENT_ENV_EXAMPLE = DEPLOY_DIR / "env" / "realtime-agent-dev.env.example"
VLLM_AGENT_ENV_EXAMPLE = DEPLOY_DIR / "env" / "realtime-agent-vllm.env.example"
VLLM_RUNTIME_ENV_EXAMPLE = DEPLOY_DIR / "env" / "whisper-vllm.env.example"
NEMO_AGENT_ENV_EXAMPLE = DEPLOY_DIR / "env" / "realtime-agent-nemo.env.example"
NEMO_RUNTIME_ENV_EXAMPLE = DEPLOY_DIR / "env" / "nemotron-nemo.env.example"


def test_probe_settings_redact_credentials_from_repr() -> None:
    settings = ProbeSettings.from_values(
        "wss://livekit.example",
        "private-api-key",
        "private-api-secret",
        "session-1",
    )

    rendered = repr(settings)

    assert "private-api-key" not in rendered
    assert "private-api-secret" not in rendered
    assert "session-1" in rendered


def test_probe_snapshot_reports_only_microphone_state() -> None:
    microphone = SimpleNamespace(
        sid="TR_audio",
        name="mic",
        type=api.TrackType.AUDIO,
        source=api.TrackSource.MICROPHONE,
        muted=False,
    )
    camera = SimpleNamespace(
        sid="TR_video",
        name="camera",
        type=api.TrackType.VIDEO,
        source=api.TrackSource.CAMERA,
        muted=False,
    )
    participant = SimpleNamespace(
        identity="teacher",
        tracks=[microphone, camera],
    )

    snapshot = format_room_snapshot("session-1", [participant])

    assert "TR_audio" in snapshot
    assert "TR_video" not in snapshot
    assert "token" not in snapshot.lower()


def test_caption_formatter_preserves_utf8_and_completion() -> None:
    assert format_entry("1-0", {"type": "caption.delta", "delta": "안녕하세요"}, raw=False) == (
        "안녕하세요"
    )
    completed = format_entry(
        "2-0",
        {
            "type": "caption.stream.completed",
            "sessionId": "session-1",
            "lastSequence": "7",
            "reason": "room_deleted",
        },
        raw=False,
    )
    assert completed is not None and "sequence=7" in completed


def test_caption_monitor_requires_session_filter() -> None:
    with pytest.raises(SystemExit):
        parse_monitor_args([])


def test_tunnel_script_requires_explicit_connection_target() -> None:
    environ = {
        key: value for key, value in os.environ.items() if key not in {"SSH_KEY", "SSH_TARGET"}
    }
    result = subprocess.run(
        ["sh", "-n", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environ,
    )
    assert result.returncode == 0

    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environ,
    )
    assert result.returncode != 0
    assert "SSH_KEY" in result.stderr


def test_tunnel_script_rejects_listener_not_owned_by_managed_ssh(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_ssh = fake_bin / "ssh"
    fake_ssh.write_text(
        '#!/bin/sh\ncase " $* " in *" -O check "*) exit 1 ;; esac\nexit 99\n',
        encoding="utf-8",
    )
    fake_nc = fake_bin / "nc"
    fake_nc.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_ssh.chmod(0o700)
    fake_nc.chmod(0o700)
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    environ = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "SSH_KEY": str(key),
        "SSH_TARGET": "user@example.invalid",
        "SSH_CONTROL_PATH": str(tmp_path / "control.sock"),
    }

    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environ,
    )

    assert result.returncode != 0
    assert "outside the managed SSH tunnel" in result.stderr


def test_tunnel_migrates_legacy_turn_forward_to_separate_ssh_connection(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    state = tmp_path / "state"
    state.mkdir()
    fake_ssh = fake_bin / "ssh"
    fake_ssh.write_text(
        """#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_STATE/ssh.log"
case " $* " in
    *" -O check "*)
        case " $* " in
            *" $TURN_SSH_CONTROL_PATH "*) test -e "$FAKE_STATE/turn-started" ;;
            *) exit 0 ;;
        esac
        ;;
    *" -O cancel "*)
        : > "$FAKE_STATE/legacy-turn-cancelled"
        exit 0
        ;;
    *" -M "*)
        case " $* " in
            *" $TURN_SSH_CONTROL_PATH "*) : > "$FAKE_STATE/turn-started" ;;
            *) exit 91 ;;
        esac
        exit 0
        ;;
esac
exit 92
""",
        encoding="utf-8",
    )
    fake_nc = fake_bin / "nc"
    fake_nc.write_text(
        """#!/bin/sh
for port do :; done
case "$port" in
    7443|4000|6390) exit 0 ;;
    3478)
        if [ ! -e "$FAKE_STATE/legacy-turn-cancelled" ] || [ -e "$FAKE_STATE/turn-started" ]; then
            exit 0
        fi
        exit 1
        ;;
esac
exit 1
""",
        encoding="utf-8",
    )
    fake_ssh.chmod(0o700)
    fake_nc.chmod(0o700)
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    control_path = tmp_path / "control.sock"
    turn_control_path = tmp_path / "turn-control.sock"
    (tmp_path / "control.sock.health-18081").touch()
    (tmp_path / "control.sock.health-18082").touch()
    environ = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "FAKE_STATE": str(state),
        "SSH_KEY": str(key),
        "SSH_TARGET": "user@example.invalid",
        "SSH_CONTROL_PATH": str(control_path),
        "TURN_SSH_CONTROL_PATH": str(turn_control_path),
    }

    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environ,
    )

    assert result.returncode == 0, result.stderr
    assert (state / "legacy-turn-cancelled").exists()
    assert (state / "turn-started").exists()
    ssh_log = (state / "ssh.log").read_text(encoding="utf-8")
    assert "-O cancel -L 3478:localhost:3478" in ssh_log
    turn_start = next(line for line in ssh_log.splitlines() if " -M " in f" {line} ")
    assert f"-S {turn_control_path}" in turn_start
    assert "-L 3478:localhost:3478" in turn_start
    assert "-L 7443:localhost:7443" not in turn_start
    assert "-L 4000:localhost:4000" not in turn_start
    assert "-L 6390:localhost:6390" not in turn_start


def test_tunnel_adds_missing_prod_redis_forward_to_existing_control(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    state = tmp_path / "state"
    state.mkdir()
    fake_ssh = fake_bin / "ssh"
    fake_ssh.write_text(
        """#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_STATE/ssh.log"
case " $* " in
    *" -O check "*) exit 0 ;;
    *" -O forward "*)
        case " $* " in
            *" -L 6390:localhost:6390 "*)
                : > "$FAKE_STATE/prod-redis-forwarded"
                exit 0
                ;;
        esac
        ;;
esac
exit 92
""",
        encoding="utf-8",
    )
    fake_nc = fake_bin / "nc"
    fake_nc.write_text(
        """#!/bin/sh
for port do :; done
case "$port" in
    7443|4000|3478) exit 0 ;;
    6390) test -e "$FAKE_STATE/prod-redis-forwarded" && exit 0 ;;
esac
exit 1
""",
        encoding="utf-8",
    )
    fake_ssh.chmod(0o700)
    fake_nc.chmod(0o700)
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    control_path = tmp_path / "control.sock"
    turn_control_path = tmp_path / "turn-control.sock"
    (tmp_path / "control.sock.health-18081").touch()
    (tmp_path / "control.sock.health-18082").touch()
    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "FAKE_STATE": str(state),
            "SSH_KEY": str(key),
            "SSH_TARGET": "user@example.invalid",
            "SSH_CONTROL_PATH": str(control_path),
            "TURN_SSH_CONTROL_PATH": str(turn_control_path),
        },
    )

    assert result.returncode == 0, result.stderr
    ssh_log = (state / "ssh.log").read_text(encoding="utf-8")
    assert "-O forward -L 6390:localhost:6390" in ssh_log


def test_tunnel_requires_distinct_control_paths(tmp_path: Path) -> None:
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    shared_path = tmp_path / "shared.sock"
    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "SSH_KEY": str(key),
            "SSH_TARGET": "user@example.invalid",
            "SSH_CONTROL_PATH": str(shared_path),
            "TURN_SSH_CONTROL_PATH": str(shared_path),
        },
    )

    assert result.returncode != 0
    assert "must be different" in result.stderr


@pytest.mark.parametrize(
    "script",
    [
        TUNNEL_SCRIPT,
        DEPLOY_SCRIPT,
        SUPERVISOR_SCRIPT,
        VLLM_BOOTSTRAP_SCRIPT,
        VLLM_SUPERVISOR_SCRIPT,
        RUNNER_CONTROL_SCRIPT,
        INSTALL_SCRIPT,
        RUNNER_INSTALL_SCRIPT,
        TUNNEL_CONFIGURE_SCRIPT,
    ],
)
def test_operational_shell_scripts_have_valid_syntax(script: Path) -> None:
    result = subprocess.run(
        ["sh", "-n", str(script)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_deploy_helper_rejects_unsafe_release_id_before_privileged_work() -> None:
    result = subprocess.run(
        [str(DEPLOY_SCRIPT), "/tmp/not-used", "../master"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
    assert "release ID" in result.stderr


def test_tunnel_includes_dev_prod_redis_and_loopback_health_forwards() -> None:
    script = TUNNEL_SCRIPT.read_text(encoding="utf-8")

    assert 'DEV_REDIS_LOCAL_PORT="${DEV_REDIS_LOCAL_PORT:-4000}"' in script
    assert 'PROD_REDIS_LOCAL_PORT="${PROD_REDIS_LOCAL_PORT:-6390}"' in script
    assert 'PROD_HEALTH_LOCAL_PORT="${PROD_HEALTH_LOCAL_PORT:-8081}"' in script
    assert 'DEV_HEALTH_LOCAL_PORT="${DEV_HEALTH_LOCAL_PORT:-8082}"' in script
    assert 'PROD_HEALTH_REMOTE_PORT="${PROD_HEALTH_REMOTE_PORT:-18081}"' in script
    assert 'DEV_HEALTH_REMOTE_PORT="${DEV_HEALTH_REMOTE_PORT:-18082}"' in script
    assert 'HEALTH_BIND_HOST="${HEALTH_BIND_HOST:-127.0.0.1}"' in script
    assert '-L "$DEV_REDIS_LOCAL_PORT:localhost:$DEV_REDIS_REMOTE_PORT"' in script
    assert '-L "$PROD_REDIS_LOCAL_PORT:localhost:$PROD_REDIS_REMOTE_PORT"' in script
    assert (
        '-R "$HEALTH_BIND_HOST:$PROD_HEALTH_REMOTE_PORT:127.0.0.1:'
        '$PROD_HEALTH_LOCAL_PORT"' in script
    )
    assert (
        '-R "$HEALTH_BIND_HOST:$DEV_HEALTH_REMOTE_PORT:127.0.0.1:$DEV_HEALTH_LOCAL_PORT"' in script
    )
    assert "ExitOnForwardFailure=yes" in script
    assert "StrictHostKeyChecking=yes" in script
    assert "IdentitiesOnly=yes" in script
    assert "HEALTH_BIND_HOST must be 127.0.0.1" in script


def test_production_tunnel_configurator_installs_one_key_for_both_services(
    tmp_path: Path,
) -> None:
    source_key = tmp_path / "source.pem"
    source_key.write_text("test-private-key\n", encoding="utf-8")
    home = tmp_path / "home"
    config_dir = home / ".config" / "liveclass"
    environ = {
        **os.environ,
        "HOME": str(home),
        "LIVECLASS_CONFIG_DIR": str(config_dir),
    }

    result = subprocess.run(
        [str(TUNNEL_CONFIGURE_SCRIPT), str(source_key), "ubuntu@ec2.example"],
        check=False,
        capture_output=True,
        text=True,
        env=environ,
    )

    assert result.returncode == 0, result.stderr
    installed_key = config_dir / "ssh" / "gpu-to-ec2.pem"
    realtime_env = (config_dir / "realtime-agent-tunnels.env").read_text(encoding="utf-8")
    bge_env = (config_dir / "bge-tunnel.env").read_text(encoding="utf-8")
    assert installed_key.read_text(encoding="utf-8") == "test-private-key\n"
    assert installed_key.stat().st_mode & 0o777 == 0o600
    assert f"SSH_KEY={installed_key}" in realtime_env
    assert f"SSH_KEY={installed_key}" in bge_env
    assert "SSH_TARGET=ubuntu@ec2.example" in realtime_env
    assert "SSH_TARGET=ubuntu@ec2.example" in bge_env
    assert "PROD_HEALTH_REMOTE_PORT=18081" in realtime_env
    assert "DEV_HEALTH_REMOTE_PORT=18082" in realtime_env
    assert "SSH_CONTROL_PATH=" in realtime_env
    assert "TURN_SSH_CONTROL_PATH=" in realtime_env
    realtime_values = dict(
        line.split("=", maxsplit=1)
        for line in realtime_env.splitlines()
        if line and not line.startswith("#")
    )
    assert realtime_values["SSH_CONTROL_PATH"] != realtime_values["TURN_SSH_CONTROL_PATH"]
    assert realtime_values["DEV_REDIS_LOCAL_PORT"] == "4000"
    assert realtime_values["DEV_REDIS_REMOTE_PORT"] == "4000"
    assert realtime_values["PROD_REDIS_LOCAL_PORT"] == "6390"
    assert realtime_values["PROD_REDIS_REMOTE_PORT"] == "6390"
    assert realtime_values["PROD_HEALTH_LOCAL_PORT"] == "8081"
    assert realtime_values["DEV_HEALTH_LOCAL_PORT"] == "8082"
    assert "BGE_EC2_PORT=18020" in bge_env
    assert (config_dir / "realtime-agent-tunnels.env").stat().st_mode & 0o777 == 0o600
    assert (config_dir / "bge-tunnel.env").stat().st_mode & 0o777 == 0o600


def test_dual_environment_examples_isolate_names_redis_health_and_capacity() -> None:
    common = COMMON_AGENT_ENV_EXAMPLE.read_text(encoding="utf-8")
    prod = PROD_AGENT_ENV_EXAMPLE.read_text(encoding="utf-8")
    dev = DEV_AGENT_ENV_EXAMPLE.read_text(encoding="utf-8")

    assert "CAPTION_STREAM_KEY=ai:captions:live" in common
    assert "SESSION_LEASE_TTL_SECONDS=30" in common
    assert "SPRING_STATUS_CALLBACK_ENABLED=false" in common
    assert "ASR_LANGUAGE=ko-KR" in common
    assert "STT_HEALTH_HOST=127.0.0.1" in common

    assert "REDIS_URL=redis://127.0.0.1:6390/0" in prod
    assert "STT_AGENT_NAME=liveclass-realtime-stt-prod" in prod
    assert "STT_HEALTH_PORT=8081" in prod
    assert "STT_MAX_ACTIVE_JOBS=12" in prod
    assert "STT_ENGINE_PROVIDER=nemotron" in prod
    assert "ASR_MODEL_ID=" in prod
    assert "OPENAI_API_KEY=" not in prod
    assert "REDIS_URL=redis://:<dev-redis-password>@127.0.0.1:4000/0" in dev
    assert "STT_AGENT_NAME=liveclass-realtime-stt-dev\n" in dev
    assert "STT_AGENT_NAME=liveclass-realtime-stt-prod" not in dev
    assert "STT_HEALTH_PORT=8082" in dev
    assert "STT_MAX_ACTIVE_JOBS=1" in dev
    assert "STT_NUM_IDLE_PROCESSES=1" in dev
    assert "STT_ENGINE_PROVIDER=openai-realtime" in dev
    assert "OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper" in dev
    assert "ASR_MODEL_ID=" not in dev
    assert "CUDA_VISIBLE_DEVICES=" not in dev


def test_vllm_examples_keep_gpu0_loopback_and_conservative_capacity() -> None:
    agent = VLLM_AGENT_ENV_EXAMPLE.read_text(encoding="utf-8")
    runtime = VLLM_RUNTIME_ENV_EXAMPLE.read_text(encoding="utf-8")
    supervisor = VLLM_SUPERVISOR_SCRIPT.read_text(encoding="utf-8")
    bootstrap = VLLM_BOOTSTRAP_SCRIPT.read_text(encoding="utf-8")

    assert "STT_ENGINE_PROVIDER=vllm-whisper" in agent
    assert "STT_MAX_ACTIVE_JOBS=1" in agent
    assert "STT_NUM_IDLE_PROCESSES=1" in agent
    assert "VLLM_WHISPER_BASE_URL=http://127.0.0.1:18083/v1" in agent
    assert "VLLM_WHISPER_MODEL=liveclass-qwen3-asr-1.7b" in agent
    assert "CUDA_VISIBLE_DEVICES=0" in runtime
    assert "WHISPER_VLLM_HOST=127.0.0.1" in runtime
    assert "WHISPER_VLLM_SERVE_COMMAND=qwen-asr-serve" in runtime
    assert "qwen-asr-serve" in supervisor
    assert "WHISPER_VLLM_MAX_NUM_SEQS=1" in runtime
    assert "WHISPER_VLLM_GPU_MEMORY_UTILIZATION=0.10" in runtime
    assert "WHISPER_VLLM_MAX_NUM_BATCHED_TOKENS=2048" in runtime
    assert "WHISPER_VLLM_MODEL_PATH=/home/<user>/ai/models/qwen3-asr-1.7b" in runtime
    assert "WHISPER_VLLM_SERVED_MODEL_NAME=liveclass-qwen3-asr-1.7b" in runtime
    assert "GPU 0" in supervisor
    assert '--host "$WHISPER_VLLM_HOST"' in supervisor
    assert "--max-num-batched-tokens" in supervisor
    assert "/v1/models" in supervisor
    assert "qwen-asr[vllm]==" in bootstrap
    assert "sudo" not in supervisor
    assert "sudo" not in bootstrap


def test_nemotron_nemo_examples_use_tuned_checkpoint_and_loopback() -> None:
    agent = NEMO_AGENT_ENV_EXAMPLE.read_text(encoding="utf-8")
    runtime = NEMO_RUNTIME_ENV_EXAMPLE.read_text(encoding="utf-8")
    supervisor = NEMO_SUPERVISOR_SCRIPT.read_text(encoding="utf-8")

    assert "STT_ENGINE_PROVIDER=nemotron-nemo" in agent
    assert "STT_MAX_ACTIVE_JOBS=5" in agent
    assert "STT_NUM_IDLE_PROCESSES=5" in agent
    assert "NEMO_RUNTIME_BASE_URL=http://127.0.0.1:18084/v1" in agent
    assert "NEMO_RUNTIME_MODEL=liveclass-nemotron-3.5-tuned" in agent
    assert "CUDA_VISIBLE_DEVICES=0" in runtime
    assert "NEMO_RUNTIME_HOST=127.0.0.1" in runtime
    assert "NEMO_RUNTIME_PORT=18084" in runtime
    assert "NEMO_RUNTIME_REPLICAS=5" in runtime
    assert '--replicas "$NEMO_RUNTIME_REPLICAS"' in supervisor
    assert "LiveClass-Nemotron-3.5-ASR-Full-Finetune.nemo" in runtime
    assert "nemotron_nemo_server.py" in supervisor
    assert "/v1/models" in supervisor
    assert "sudo" not in supervisor


def test_vllm_supervisor_health_executes_embedded_probe(tmp_path: Path) -> None:
    class ModelsHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/v1/models":
                self.send_response(404)
                self.end_headers()
                return
            body = b'{"data":[{"id":"liveclass-qwen3-asr-1.7b"}]}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), ModelsHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    venv_bin = tmp_path / "venv" / "bin"
    venv_bin.mkdir(parents=True)
    (venv_bin / "python").symlink_to(sys.executable)
    runtime_env = tmp_path / "whisper-vllm.env"
    runtime_env.write_text(
        "\n".join(
            [
                f"WHISPER_VLLM_VENV={venv_bin.parent}",
                "WHISPER_VLLM_HOST=127.0.0.1",
                f"WHISPER_VLLM_PORT={server.server_address[1]}",
                "WHISPER_VLLM_SERVED_MODEL_NAME=liveclass-qwen3-asr-1.7b",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    try:
        result = subprocess.run(
            [str(VLLM_SUPERVISOR_SCRIPT), "health"],
            check=False,
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "LIVECLASS_WHISPER_VLLM_ENV": str(runtime_env),
            },
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert result.returncode == 0, result.stderr


def test_rootless_supervisor_keeps_tunnel_and_dual_agents_under_tmux() -> None:
    supervisor = SUPERVISOR_SCRIPT.read_text(encoding="utf-8")
    installer = INSTALL_SCRIPT.read_text(encoding="utf-8")

    assert "tmux new-session -d" in supervisor
    assert "tmux has-session" in supervisor
    assert "liveclass-realtime-agent-prod" in supervisor
    assert "liveclass-realtime-agent-dev" in supervisor
    assert "realtime-agent-dev.env" in supervisor
    assert "realtime-agent-common.env" in supervisor
    assert "_run-agent-prod" in supervisor
    assert "_run-agent-dev" in supervisor
    assert 'stop_session "$LEGACY_AGENT_SESSION"' in supervisor
    assert "status-agent)" in supervisor
    assert "logs-agent-prod)" in supervisor
    assert "logs-agent-dev)" in supervisor
    assert "restart-agent-prod)" in supervisor
    assert "restart-agent-dev)" in supervisor
    assert "stop-agent-prod)" in supervisor
    assert "vllm-whisper)" in supervisor
    assert "LIVEKIT_TUNNEL_HOST" in supervisor
    assert "LD_PRELOAD" in supervisor
    assert "realtime-agent-dev.env.example" in installer
    assert "realtime-agent-common.env.example" in installer
    assert "whisper-vllm.env.example" in installer
    assert "realtime-agent-vllm.env.example" in installer
    assert "liveclass-whisper-vllm-supervisor" in installer
    assert "liveclass-whisper-vllm-bootstrap" in installer
    assert "nemotron-nemo)" in supervisor
    assert "NEMO_RUNTIME_BASE_URL" in supervisor
    assert "liveclass-nemotron-nemo-supervisor" in installer
    assert "nemotron-nemo.env.example" in installer
    assert "realtime-agent-nemo.env.example" in installer
    assert "systemctl" not in supervisor
    assert "sudo" not in supervisor
    assert "systemctl" not in installer
    assert "sudo" not in installer


def test_rootless_supervisor_rejects_mixed_environment_before_stopping_sessions(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_tmux = fake_bin / "tmux"
    fake_tmux.write_text(
        """#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
    has-session) exit 1 ;;
    new-session) exit 0 ;;
esac
exit 0
""",
        encoding="utf-8",
    )
    fake_tmux.chmod(0o700)
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    common = """STT_HEALTH_HOST=127.0.0.1
"""
    (config_dir / "realtime-agent-common.env").write_text(common, encoding="utf-8")
    prod_provider = """STT_ENGINE_PROVIDER=nemotron
CUDA_VISIBLE_DEVICES=0
ASR_MODEL_ID=/tmp/nemotron
"""
    dev_provider = """STT_ENGINE_PROVIDER=openai-realtime
OPENAI_API_KEY=test-key
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper
OPENAI_REALTIME_TRANSCRIPTION_DELAY=low
"""
    prod_env = config_dir / "realtime-agent.env"
    prod_env.write_text(
        prod_provider
        + """REDIS_URL=redis://127.0.0.1:6390/0
STT_AGENT_NAME=liveclass-realtime-stt-dev
STT_HEALTH_PORT=8081
STT_MAX_ACTIVE_JOBS=12
STT_NUM_IDLE_PROCESSES=12
""",
        encoding="utf-8",
    )
    (config_dir / "realtime-agent-dev.env").write_text(
        dev_provider
        + """REDIS_URL=redis://:dev-test@127.0.0.1:4000/0
STT_AGENT_NAME=liveclass-realtime-stt-dev
STT_HEALTH_PORT=8082
STT_MAX_ACTIVE_JOBS=1
STT_NUM_IDLE_PROCESSES=1
""",
        encoding="utf-8",
    )
    tmux_log = tmp_path / "tmux.log"

    result = subprocess.run(
        [str(SUPERVISOR_SCRIPT), "start-agent"],
        check=False,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "FAKE_TMUX_LOG": str(tmux_log),
            "LIVECLASS_CONFIG_DIR": str(config_dir),
        },
    )

    assert result.returncode != 0
    assert "prod agent env profile mismatch" in result.stderr
    assert not tmux_log.exists()

    prod_env.write_text(
        prod_env.read_text(encoding="utf-8").replace(
            "STT_AGENT_NAME=liveclass-realtime-stt-dev\n",
            "STT_AGENT_NAME=liveclass-realtime-stt-prod\n",
        ),
        encoding="utf-8",
    )
    deploy_root = tmp_path / "deploy"
    python_path = deploy_root / "current" / ".venv" / "bin" / "python"
    python_path.parent.mkdir(parents=True)
    python_path.touch()

    valid_result = subprocess.run(
        [str(SUPERVISOR_SCRIPT), "start-agent"],
        check=False,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "FAKE_TMUX_LOG": str(tmux_log),
            "LIVECLASS_CONFIG_DIR": str(config_dir),
            "LIVECLASS_DEPLOY_ROOT": str(deploy_root),
        },
    )

    assert valid_result.returncode == 0, valid_result.stderr
    logged_commands = tmux_log.read_text(encoding="utf-8")
    assert "new-session -d -s liveclass-realtime-agent-prod" in logged_commands
    assert "_run-agent-prod" in logged_commands
    assert "new-session -d -s liveclass-realtime-agent-dev" in logged_commands
    assert "_run-agent-dev" in logged_commands


def test_dns_redirect_source_compiles(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            "cc",
            "-shared",
            "-fPIC",
            "-Wall",
            "-Wextra",
            "-Werror",
            str(DNS_REDIRECT_SOURCE),
            "-ldl",
            "-o",
            str(tmp_path / "livekit-tunnel-dns.so"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_deploy_helper_builds_before_switch_and_keeps_rollback_path() -> None:
    script = DEPLOY_SCRIPT.read_text(encoding="utf-8")

    sync_position = script.index('"$UV_BIN" sync')
    cuda_smoke_position = script.index("assert torch.cuda.is_available()")
    switch_position = script.index('mv -Tf "$NEXT_LINK" "$CURRENT_LINK"')
    unlock_position = script.index("flock -u 9")
    model_runtime_position = script.index('"$NEMO_SUPERVISOR" restart')
    agent_restart_position = script.index('"$SUPERVISOR" restart-agent')
    health_position = script.index("for health_url")
    process_gate_position = script.index('"$SUPERVISOR" status-agent')
    command_refresh_position = script.index("refresh_runtime_command")

    assert (
        sync_position
        < cuda_smoke_position
        < switch_position
        < unlock_position
        < model_runtime_position
        < agent_restart_position
        < process_gate_position
        < health_position
        < command_refresh_position
    )
    assert 'PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK"' in script
    assert 'mv -Tf "$ROLLBACK_LINK" "$CURRENT_LINK"' in script
    assert "systemctl" not in script
    assert "runuser" not in script
    assert "sudo" not in script
    assert "http://127.0.0.1:8081/health/ready" in script
    assert "http://127.0.0.1:8082/health/ready" in script
    assert 'for health_url in "$PROD_HEALTH_URL" "$DEV_HEALTH_URL"' in script
    assert '"$RELEASE_DIR/deploy/bin/liveclass-realtime-agent-supervisor" stop-agent' in script
    assert "liveclass-realtime-agent-supervisor" in script[command_refresh_position:]
    assert "liveclass-realtime-agent-deploy" in script[command_refresh_position:]


@pytest.mark.asyncio
async def test_nemotron_nemo_runtime_pool_runs_replicas_concurrently() -> None:
    import asyncio
    import importlib.util

    module_name = "test_nemotron_nemo_runtime"
    spec = importlib.util.spec_from_file_location(module_name, NEMO_RUNTIME_SERVER)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)

        barrier = threading.Barrier(2)

        class FakeTranscriber:
            model = object()

            def __init__(self, text: str) -> None:
                self.text = text

            def transcribe(self, _payload: bytes) -> str:
                barrier.wait(timeout=2)
                return self.text

        pool = module.NemoTranscriberPool([FakeTranscriber("first"), FakeTranscriber("second")])

        results = await asyncio.gather(pool.transcribe(b"a"), pool.transcribe(b"b"))

        assert sorted(results) == ["first", "second"]
        assert pool.replica_count == 2
        assert pool.ready_replica_count == 2
    finally:
        sys.modules.pop(module_name, None)
