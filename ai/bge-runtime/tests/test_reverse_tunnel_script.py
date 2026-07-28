from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

TUNNEL_SCRIPT = Path(__file__).parents[1] / "scripts" / "start_ec2_reverse_tunnel.sh"


SCRIPT_ENVIRONMENT_VARIABLES = {
    "SSH_KEY",
    "SSH_TARGET",
    "BGE_LOCAL_PORT",
    "BGE_EC2_PORT",
    "BGE_READY_TIMEOUT_SECONDS",
}


def _clean_environment() -> dict[str, str]:
    return {
        key: value for key, value in os.environ.items() if key not in SCRIPT_ENVIRONMENT_VARIABLES
    }


@pytest.mark.parametrize("missing", ["SSH_KEY", "SSH_TARGET"])
def test_reverse_tunnel_script_requires_explicit_connection_target(
    tmp_path: Path,
    missing: str,
) -> None:
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    environment = {
        **_clean_environment(),
        "SSH_KEY": str(key),
        "SSH_TARGET": "tunnel@example.invalid",
    }
    del environment[missing]

    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert result.returncode != 0
    assert missing in result.stderr


def test_reverse_tunnel_binds_only_ec2_loopback_and_stays_foreground(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    args_file = tmp_path / "ssh-args"
    curl_args_file = tmp_path / "curl-args"
    fake_curl = fake_bin / "curl"
    fake_curl.write_text(
        """#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS_FILE"
""",
        encoding="utf-8",
    )
    fake_ssh = fake_bin / "ssh"
    fake_ssh.write_text(
        '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$SSH_ARGS_FILE"\n',
        encoding="utf-8",
    )
    fake_curl.chmod(0o700)
    fake_ssh.chmod(0o700)
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    environment = {
        **_clean_environment(),
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "SSH_ARGS_FILE": str(args_file),
        "CURL_ARGS_FILE": str(curl_args_file),
        "SSH_KEY": str(key),
        "SSH_TARGET": "tunnel@example.invalid",
        "BGE_LOCAL_PORT": "8020",
        "BGE_EC2_PORT": "18020",
        "BGE_READY_TIMEOUT_SECONDS": "5",
    }

    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert result.returncode == 0
    arguments = args_file.read_text(encoding="utf-8").splitlines()
    curl_arguments = curl_args_file.read_text(encoding="utf-8").splitlines()
    assert curl_arguments == [
        "-fsS",
        "--max-time",
        "5",
        "http://127.0.0.1:8020/readyz",
    ]
    assert "-T" in arguments
    assert "-N" in arguments
    assert "-f" not in arguments
    assert "-F" in arguments
    assert "/dev/null" in arguments
    assert "-R" in arguments
    assert "127.0.0.1:18020:127.0.0.1:8020" in arguments
    assert "ExitOnForwardFailure=yes" in arguments
    assert "ServerAliveInterval=30" in arguments
    assert "StrictHostKeyChecking=yes" in arguments
    assert "tunnel@example.invalid" == arguments[-1]
    assert all("0.0.0.0" not in argument for argument in arguments)


def test_reverse_tunnel_refuses_to_start_before_local_bge_is_ready(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    ssh_called = tmp_path / "ssh-called"
    fake_curl = fake_bin / "curl"
    fake_curl.write_text("#!/bin/sh\nexit 22\n", encoding="utf-8")
    fake_ssh = fake_bin / "ssh"
    fake_ssh.write_text(
        f"#!/bin/sh\ntouch {ssh_called}\nexit 0\n",
        encoding="utf-8",
    )
    fake_curl.chmod(0o700)
    fake_ssh.chmod(0o700)
    key = tmp_path / "test-key.pem"
    key.touch(mode=0o600)
    environment = {
        **_clean_environment(),
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "SSH_KEY": str(key),
        "SSH_TARGET": "tunnel@example.invalid",
    }

    result = subprocess.run(
        ["sh", str(TUNNEL_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert result.returncode != 0
    assert "local BGE runtime is not ready" in result.stderr
    assert not ssh_called.exists()
