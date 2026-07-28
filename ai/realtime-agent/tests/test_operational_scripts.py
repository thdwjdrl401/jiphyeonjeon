from __future__ import annotations

import os
import subprocess
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
FOREGROUND_TUNNEL_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-realtime-agent-tunnels"
INSTALL_SCRIPT = DEPLOY_DIR / "install.sh"
AGENT_SERVICE = DEPLOY_DIR / "systemd" / "liveclass-realtime-agent.service"
TUNNEL_SERVICE = DEPLOY_DIR / "systemd" / "liveclass-realtime-agent-tunnels.service"


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


@pytest.mark.parametrize(
    "script",
    [TUNNEL_SCRIPT, DEPLOY_SCRIPT, FOREGROUND_TUNNEL_SCRIPT, INSTALL_SCRIPT],
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


def test_foreground_tunnel_executes_ssh_without_backgrounding(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    args_file = tmp_path / "ssh-args"
    fake_ssh = fake_bin / "ssh"
    fake_ssh.write_text(
        '#!/bin/sh\nprintf "%s\\n" "$@" >"$ARGS_FILE"\n',
        encoding="utf-8",
    )
    fake_ssh.chmod(0o700)
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    environ = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "ARGS_FILE": str(args_file),
        "SSH_KEY": str(key),
        "SSH_TARGET": "user@example.invalid",
    }

    result = subprocess.run(
        [str(FOREGROUND_TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environ,
    )

    assert result.returncode == 0, result.stderr
    arguments = args_file.read_text(encoding="utf-8").splitlines()
    assert "-N" in arguments
    assert "-T" in arguments
    assert "-f" not in arguments
    assert sum(argument == "-L" for argument in arguments) == 3


def test_systemd_units_keep_tunnel_and_agent_under_supervision() -> None:
    tunnel_unit = TUNNEL_SERVICE.read_text(encoding="utf-8")
    agent_unit = AGENT_SERVICE.read_text(encoding="utf-8")

    assert "Restart=always" in tunnel_unit
    assert "EnvironmentFile=/etc/liveclass/realtime-agent-tunnels.env" in tunnel_unit
    assert "Requires=liveclass-realtime-agent-tunnels.service" in agent_unit
    assert "Restart=on-failure" in agent_unit
    assert "KillSignal=SIGTERM" in agent_unit
    assert "TimeoutStopSec=300" in agent_unit


def test_deploy_helper_builds_before_switch_and_keeps_rollback_path() -> None:
    script = DEPLOY_SCRIPT.read_text(encoding="utf-8")

    sync_position = script.index('"$UV_BIN" sync')
    cuda_smoke_position = script.index("assert torch.cuda.is_available()")
    root_owner_position = script.index('chown -R root:root "$STAGING_DIR"')
    switch_position = script.index('mv -Tf "$NEXT_LINK" "$CURRENT_LINK"')
    health_position = script.index("--retry 30")

    assert (
        sync_position
        < cuda_smoke_position
        < root_owner_position
        < switch_position
        < health_position
    )
    assert 'PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK"' in script
    assert 'mv -Tf "$ROLLBACK_LINK" "$CURRENT_LINK"' in script
