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


def test_probe_settings_reject_missing_credentials_without_exposing_values() -> None:
    with pytest.raises(RuntimeError, match="LIVEKIT_API_SECRET") as error:
        ProbeSettings.from_values("wss://livekit.example", "api-key", "", "session-1")
    assert "wss://livekit.example" not in str(error.value)


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
