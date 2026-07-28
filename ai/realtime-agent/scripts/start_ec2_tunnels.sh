#!/bin/sh
set -eu

: "${SSH_KEY:?SSH_KEY must point to a readable private key}"
: "${SSH_TARGET:?SSH_TARGET must be in user@host form}"

LIVEKIT_LOCAL_PORT="${LIVEKIT_LOCAL_PORT:-7443}"
LIVEKIT_REMOTE_PORT="${LIVEKIT_REMOTE_PORT:-7443}"
REDIS_LOCAL_PORT="${REDIS_LOCAL_PORT:-4000}"
REDIS_REMOTE_PORT="${REDIS_REMOTE_PORT:-4000}"
TURN_LOCAL_PORT="${TURN_LOCAL_PORT:-3478}"
TURN_REMOTE_PORT="${TURN_REMOTE_PORT:-3478}"
SSH_CONTROL_PATH="${SSH_CONTROL_PATH:-${TMPDIR:-/tmp}/liveclass-realtime-agent-%C.sock}"

if [ ! -r "$SSH_KEY" ]; then
    echo "SSH key is not readable" >&2
    exit 1
fi

command -v ssh >/dev/null 2>&1 || {
    echo "ssh is required" >&2
    exit 1
}
command -v nc >/dev/null 2>&1 || {
    echo "nc is required" >&2
    exit 1
}

validate_port() {
    validate_port_value="$1"
    validate_port_name="$2"
    case "$validate_port_value" in
        ''|*[!0-9]*)
            echo "$validate_port_name must be an integer port" >&2
            exit 1
            ;;
    esac
    if [ "$validate_port_value" -lt 1 ] || [ "$validate_port_value" -gt 65535 ]; then
        echo "$validate_port_name must be between 1 and 65535" >&2
        exit 1
    fi
}

validate_listener_available() {
    listener_port="$1"
    listener_name="$2"
    if nc -z -w 2 127.0.0.1 "$listener_port"; then
        echo "$listener_name port is occupied by a process outside the managed SSH tunnel" >&2
        exit 1
    fi
}

validate_managed_listener() {
    listener_port="$1"
    listener_name="$2"
    if ! nc -z -w 2 127.0.0.1 "$listener_port"; then
        echo "$listener_name listener is missing from the managed SSH tunnel" >&2
        exit 1
    fi
    echo "$listener_name tunnel is listening on localhost:$listener_port"
}

validate_port "$LIVEKIT_LOCAL_PORT" LIVEKIT_LOCAL_PORT
validate_port "$LIVEKIT_REMOTE_PORT" LIVEKIT_REMOTE_PORT
validate_port "$REDIS_LOCAL_PORT" REDIS_LOCAL_PORT
validate_port "$REDIS_REMOTE_PORT" REDIS_REMOTE_PORT
validate_port "$TURN_LOCAL_PORT" TURN_LOCAL_PORT
validate_port "$TURN_REMOTE_PORT" TURN_REMOTE_PORT

if ssh -S "$SSH_CONTROL_PATH" -O check "$SSH_TARGET" >/dev/null 2>&1; then
    validate_managed_listener "$LIVEKIT_LOCAL_PORT" LIVEKIT
    validate_managed_listener "$REDIS_LOCAL_PORT" REDIS
    validate_managed_listener "$TURN_LOCAL_PORT" TURN_TCP
    exit 0
fi

validate_listener_available "$LIVEKIT_LOCAL_PORT" LIVEKIT
validate_listener_available "$REDIS_LOCAL_PORT" REDIS
validate_listener_available "$TURN_LOCAL_PORT" TURN_TCP

ssh \
    -M \
    -S "$SSH_CONTROL_PATH" \
    -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -f -N \
    -L "$LIVEKIT_LOCAL_PORT:localhost:$LIVEKIT_REMOTE_PORT" \
    -L "$REDIS_LOCAL_PORT:localhost:$REDIS_REMOTE_PORT" \
    -L "$TURN_LOCAL_PORT:localhost:$TURN_REMOTE_PORT" \
    "$SSH_TARGET"

validate_managed_listener "$LIVEKIT_LOCAL_PORT" LIVEKIT
validate_managed_listener "$REDIS_LOCAL_PORT" REDIS
validate_managed_listener "$TURN_LOCAL_PORT" TURN_TCP
