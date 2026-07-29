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
HEALTH_LOCAL_PORT="${HEALTH_LOCAL_PORT:-8081}"
HEALTH_REMOTE_PORT="${HEALTH_REMOTE_PORT:-18081}"
HEALTH_BIND_HOST="${HEALTH_BIND_HOST:-127.0.0.1}"
SSH_CONTROL_PATH="${SSH_CONTROL_PATH:-${TMPDIR:-/tmp}/liveclass-realtime-agent-%C.sock}"
TURN_SSH_CONTROL_PATH="${TURN_SSH_CONTROL_PATH:-${TMPDIR:-/tmp}/liveclass-realtime-agent-turn-%C.sock}"
HEALTH_REVERSE_MARKER="$SSH_CONTROL_PATH.health-$HEALTH_REMOTE_PORT"

case "$SSH_TARGET" in
    -*|*[!A-Za-z0-9@._:-]*|*@*@*|@*|*@)
        echo "SSH_TARGET must be a safe user@host value" >&2
        exit 1
        ;;
    ?*@?*)
        ;;
    *)
        echo "SSH_TARGET must be in user@host form" >&2
        exit 1
        ;;
esac
if [ "$HEALTH_BIND_HOST" != "127.0.0.1" ]; then
    echo "HEALTH_BIND_HOST must be 127.0.0.1" >&2
    exit 1
fi
if [ "$SSH_CONTROL_PATH" = "$TURN_SSH_CONTROL_PATH" ]; then
    echo "SSH_CONTROL_PATH and TURN_SSH_CONTROL_PATH must be different" >&2
    exit 1
fi

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
validate_port "$HEALTH_LOCAL_PORT" HEALTH_LOCAL_PORT
validate_port "$HEALTH_REMOTE_PORT" HEALTH_REMOTE_PORT

control_connection_exists() {
    ssh -F /dev/null -S "$SSH_CONTROL_PATH" -O check "$SSH_TARGET" >/dev/null 2>&1
}

turn_connection_exists() {
    ssh -F /dev/null -S "$TURN_SSH_CONTROL_PATH" -O check "$SSH_TARGET" >/dev/null 2>&1
}

ensure_health_reverse() {
    if [ ! -e "$HEALTH_REVERSE_MARKER" ]; then
        ssh -F /dev/null -S "$SSH_CONTROL_PATH" -O forward \
            -R "$HEALTH_BIND_HOST:$HEALTH_REMOTE_PORT:127.0.0.1:$HEALTH_LOCAL_PORT" \
            "$SSH_TARGET"
        : >"$HEALTH_REVERSE_MARKER"
    fi
}

start_control_tunnel() {
    validate_listener_available "$LIVEKIT_LOCAL_PORT" LIVEKIT
    validate_listener_available "$REDIS_LOCAL_PORT" REDIS

    ssh \
        -F /dev/null \
        -T \
        -M \
        -S "$SSH_CONTROL_PATH" \
        -i "$SSH_KEY" \
        -o BatchMode=yes \
        -o ConnectTimeout=10 \
        -o ConnectionAttempts=1 \
        -o ExitOnForwardFailure=yes \
        -o IdentitiesOnly=yes \
        -o RequestTTY=no \
        -o ServerAliveInterval=30 \
        -o ServerAliveCountMax=3 \
        -o StrictHostKeyChecking=yes \
        -f -N \
        -L "$LIVEKIT_LOCAL_PORT:localhost:$LIVEKIT_REMOTE_PORT" \
        -L "$REDIS_LOCAL_PORT:localhost:$REDIS_REMOTE_PORT" \
        -R "$HEALTH_BIND_HOST:$HEALTH_REMOTE_PORT:127.0.0.1:$HEALTH_LOCAL_PORT" \
        "$SSH_TARGET"
    : >"$HEALTH_REVERSE_MARKER"
}

start_turn_tunnel() {
    validate_listener_available "$TURN_LOCAL_PORT" TURN_TCP

    ssh \
        -F /dev/null \
        -T \
        -M \
        -S "$TURN_SSH_CONTROL_PATH" \
        -i "$SSH_KEY" \
        -o BatchMode=yes \
        -o ConnectTimeout=10 \
        -o ConnectionAttempts=1 \
        -o ExitOnForwardFailure=yes \
        -o IdentitiesOnly=yes \
        -o RequestTTY=no \
        -o ServerAliveInterval=30 \
        -o ServerAliveCountMax=3 \
        -o StrictHostKeyChecking=yes \
        -f -N \
        -L "$TURN_LOCAL_PORT:localhost:$TURN_REMOTE_PORT" \
        "$SSH_TARGET"
}

if control_connection_exists; then
    ensure_health_reverse
    validate_managed_listener "$LIVEKIT_LOCAL_PORT" LIVEKIT
    validate_managed_listener "$REDIS_LOCAL_PORT" REDIS
else
    rm -f -- "$HEALTH_REVERSE_MARKER"
    start_control_tunnel
    validate_managed_listener "$LIVEKIT_LOCAL_PORT" LIVEKIT
    validate_managed_listener "$REDIS_LOCAL_PORT" REDIS
fi

if turn_connection_exists; then
    validate_managed_listener "$TURN_LOCAL_PORT" TURN_TCP
    exit 0
fi

if nc -z -w 2 127.0.0.1 "$TURN_LOCAL_PORT"; then
    if control_connection_exists && ssh -F /dev/null -S "$SSH_CONTROL_PATH" -O cancel \
        -L "$TURN_LOCAL_PORT:localhost:$TURN_REMOTE_PORT" "$SSH_TARGET" >/dev/null 2>&1; then
        echo "migrated TURN/TCP listener out of the legacy control connection"
    else
        echo "TURN_TCP port is occupied outside the managed TURN SSH tunnel" >&2
        exit 1
    fi
fi

start_turn_tunnel
validate_managed_listener "$TURN_LOCAL_PORT" TURN_TCP
