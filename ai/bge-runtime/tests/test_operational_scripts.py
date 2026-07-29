from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

DEPLOY_DIR = Path(__file__).parents[1] / "deploy"
DEPLOY_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-bge-runtime-deploy"
SUPERVISOR_SCRIPT = DEPLOY_DIR / "bin" / "liveclass-bge-runtime-supervisor"
INSTALL_SCRIPT = DEPLOY_DIR / "install.sh"


@pytest.mark.parametrize("script", [DEPLOY_SCRIPT, SUPERVISOR_SCRIPT, INSTALL_SCRIPT])
def test_operational_shell_scripts_have_valid_syntax(script: Path) -> None:
    result = subprocess.run(
        ["sh", "-n", str(script)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_deploy_helper_rejects_unsafe_release_id_before_runtime_work() -> None:
    result = subprocess.run(
        ["sh", str(DEPLOY_SCRIPT), "/tmp/not-used", "../master"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
    assert "release ID" in result.stderr


def test_rootless_supervisor_forces_gpu_zero_and_restarts_both_processes() -> None:
    supervisor = SUPERVISOR_SCRIPT.read_text(encoding="utf-8")
    installer = INSTALL_SCRIPT.read_text(encoding="utf-8")

    assert "CUDA_VISIBLE_DEVICES=0" in supervisor
    assert "BGE_RUNTIME_DEVICE=cuda" in supervisor
    assert "tmux new-session -d" in supervisor
    assert "tmux has-session" in supervisor
    assert 'SELF_PATH="$(readlink -f "$0")"' in supervisor
    assert "restart-runtime)" in supervisor
    assert "restart-tunnel)" in supervisor
    assert "TUNNEL_READY_FILE" in supervisor
    assert 'kill -0 "$tunnel_pid"' in supervisor
    assert '"$RUNTIME_SESSION:0.0"' in supervisor
    assert '"$TUNNEL_SESSION:0.0"' in supervisor
    assert "sudo" not in supervisor
    assert "systemctl" not in supervisor
    assert "sudo" not in installer
    assert "systemctl" not in installer


def test_deploy_helper_builds_before_switch_and_rolls_back_on_failed_health() -> None:
    script = DEPLOY_SCRIPT.read_text(encoding="utf-8")

    sync_position = script.index('"$UV_BIN" sync')
    gpu_gate_position = script.index("torch.cuda.device_count() == 1")
    switch_position = script.index('mv -Tf "$NEXT_LINK" "$CURRENT_LINK"')
    unlock_position = script.index("flock -u 9")
    runtime_position = script.index('"$SUPERVISOR" restart-runtime')
    health_position = script.index("--retry 60")
    tunnel_position = script.index('"$SUPERVISOR" restart-tunnel', health_position)
    tunnel_gate_position = script.index('"$SUPERVISOR" status-tunnel', tunnel_position)

    assert (
        sync_position
        < gpu_gate_position
        < switch_position
        < unlock_position
        < runtime_position
        < health_position
        < tunnel_position
        < tunnel_gate_position
    )
    assert "CUDA_VISIBLE_DEVICES=0" in script
    assert 'PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK"' in script
    assert 'mv -Tf "$ROLLBACK_LINK" "$CURRENT_LINK"' in script
    assert '"$SUPERVISOR" stop' in script
    assert "sudo" not in script
    assert "systemctl" not in script
