#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
UV_SOURCE="${1:-$(command -v uv || true)}"
USER_PREFIX="${LIVECLASS_USER_PREFIX:-$HOME/.local}"
CONFIG_DIR="${LIVECLASS_CONFIG_DIR:-$HOME/.config/liveclass}"
BIN_DIR="$USER_PREFIX/bin"
LIB_DIR="$USER_PREFIX/lib/liveclass"
DATA_DIR="${LIVECLASS_DEPLOY_ROOT:-$HOME/.local/share/liveclass/realtime-agent}"

if [ -z "$UV_SOURCE" ] || [ ! -x "$UV_SOURCE" ]; then
    echo "usage: install.sh /absolute/path/to/uv" >&2
    exit 2
fi
for command_name in cc install tmux; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "required command is missing: $command_name" >&2
        exit 1
    fi
done

install -d -m 0700 "$CONFIG_DIR" "$DATA_DIR" "$DATA_DIR/releases" "$DATA_DIR/cache/uv"
install -d -m 0755 "$BIN_DIR" "$LIB_DIR"
install -m 0755 "$SCRIPT_DIR/bin/liveclass-realtime-agent-deploy" \
    "$BIN_DIR/liveclass-realtime-agent-deploy"
install -m 0755 "$SCRIPT_DIR/bin/liveclass-realtime-agent-supervisor" \
    "$BIN_DIR/liveclass-realtime-agent-supervisor"
install -m 0755 "$SCRIPT_DIR/bin/liveclass-whisper-vllm-bootstrap" \
    "$BIN_DIR/liveclass-whisper-vllm-bootstrap"
install -m 0755 "$SCRIPT_DIR/bin/liveclass-whisper-vllm-supervisor" \
    "$BIN_DIR/liveclass-whisper-vllm-supervisor"
install -m 0755 "$SCRIPT_DIR/bin/liveclass-gitlab-runner-user" \
    "$BIN_DIR/liveclass-gitlab-runner-user"
install -m 0755 "$UV_SOURCE" "$BIN_DIR/uv"

cc -shared -fPIC -O2 -Wall -Wextra -Werror \
    "$SCRIPT_DIR/livekit-tunnel-dns.c" -ldl -o "$LIB_DIR/livekit-tunnel-dns.so"
chmod 0755 "$LIB_DIR/livekit-tunnel-dns.so"

if [ ! -e "$CONFIG_DIR/realtime-agent-common.env" ]; then
    install -m 0600 "$SCRIPT_DIR/env/realtime-agent-common.env.example" \
        "$CONFIG_DIR/realtime-agent-common.env"
fi
if [ ! -e "$CONFIG_DIR/realtime-agent.env" ]; then
    install -m 0600 "$SCRIPT_DIR/env/realtime-agent.env.example" \
        "$CONFIG_DIR/realtime-agent.env"
fi
if [ ! -e "$CONFIG_DIR/realtime-agent-dev.env" ]; then
    install -m 0600 "$SCRIPT_DIR/env/realtime-agent-dev.env.example" \
        "$CONFIG_DIR/realtime-agent-dev.env"
fi
if [ ! -e "$CONFIG_DIR/whisper-vllm.env" ]; then
    install -m 0600 "$SCRIPT_DIR/env/whisper-vllm.env.example" \
        "$CONFIG_DIR/whisper-vllm.env"
fi
install -m 0600 "$SCRIPT_DIR/env/realtime-agent-vllm.env.example" \
    "$CONFIG_DIR/realtime-agent-vllm.env.example"
if [ ! -e "$CONFIG_DIR/realtime-agent-tunnels.env" ]; then
    install -m 0600 "$SCRIPT_DIR/env/realtime-agent-tunnels.env.example" \
        "$CONFIG_DIR/realtime-agent-tunnels.env"
fi

echo "rootless runtime installed under $USER_PREFIX"
echo "edit $CONFIG_DIR/realtime-agent-common.env, realtime-agent.env, realtime-agent-dev.env, and realtime-agent-tunnels.env before the first deployment"
echo "Whisper switch templates: $CONFIG_DIR/whisper-vllm.env and realtime-agent-vllm.env.example"
echo "install and register GitLab Runner, then run: $BIN_DIR/liveclass-gitlab-runner-user start"
