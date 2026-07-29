#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
UV_SOURCE="${1:-$(command -v uv || true)}"
USER_PREFIX="${LIVECLASS_USER_PREFIX:-$HOME/.local}"
CONFIG_DIR="${LIVECLASS_CONFIG_DIR:-$HOME/.config/liveclass}"
BIN_DIR="$USER_PREFIX/bin"
DATA_DIR="${LIVECLASS_BGE_DEPLOY_ROOT:-$HOME/.local/share/liveclass/bge-runtime}"

if [ -z "$UV_SOURCE" ] || [ ! -x "$UV_SOURCE" ]; then
    echo "usage: install.sh /absolute/path/to/uv" >&2
    exit 2
fi
for command_name in install readlink tmux; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "required command is missing: $command_name" >&2
        exit 1
    fi
done

install -d -m 0700 "$CONFIG_DIR" "$DATA_DIR" "$DATA_DIR/releases" "$DATA_DIR/cache/uv"
install -d -m 0755 "$BIN_DIR"
install -m 0755 "$SCRIPT_DIR/bin/liveclass-bge-runtime-deploy" \
    "$BIN_DIR/liveclass-bge-runtime-deploy"
install -m 0755 "$SCRIPT_DIR/bin/liveclass-bge-runtime-supervisor" \
    "$BIN_DIR/liveclass-bge-runtime-supervisor"
UV_SOURCE_REAL="$(readlink -f "$UV_SOURCE")"
UV_DEST_REAL="$(readlink -f "$BIN_DIR/uv" 2>/dev/null || true)"
if [ "$UV_SOURCE_REAL" != "$UV_DEST_REAL" ]; then
    install -m 0755 "$UV_SOURCE" "$BIN_DIR/uv"
fi

if [ ! -e "$CONFIG_DIR/bge-runtime.env" ]; then
    install -m 0600 "$SCRIPT_DIR/env/bge-runtime.env.example" \
        "$CONFIG_DIR/bge-runtime.env"
fi
if [ ! -e "$CONFIG_DIR/bge-tunnel.env" ]; then
    install -m 0600 "$SCRIPT_DIR/env/bge-tunnel.env.example" \
        "$CONFIG_DIR/bge-tunnel.env"
fi

echo "rootless bge-runtime deployment installed under $USER_PREFIX"
echo "edit $CONFIG_DIR/bge-runtime.env and $CONFIG_DIR/bge-tunnel.env before deployment"
