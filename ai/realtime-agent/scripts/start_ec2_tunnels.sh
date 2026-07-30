#!/bin/sh
set -eu

: "${SSH_KEY:?SSH_KEY must point to a readable private key}"
: "${SSH_TARGET:?SSH_TARGET must be in user@host form}"

LIVEKIT_LOCAL_PORT="${LIVEKIT_LOCAL_PORT:-7443}"
LIVEKIT_REMOTE_PORT="${LIVEKIT_REMOTE_PORT:-7443}"
DEV_REDIS_LOCAL_PORT="${DEV_REDIS_LOCAL_PORT:-4000}"
DEV_REDIS_REMOTE_PORT="${DEV_REDIS_REMOTE_PORT:-4000}"
PROD_REDIS_LOCAL_PORT="${PROD_REDIS_LOCAL_PORT:-6390}"
PROD_REDIS_REMOTE_PORT="${PROD_REDIS_REMOTE_PORT:-6390}"
TURN_LOCAL_PORT="${TURN_LOCAL_PORT:-3478}"
TURN_REMOTE_PORT="${TURN_REMOTE_PORT:-3478}"
PROD_HEALTH_LOCAL_PORT="${PROD_HEALTH_LOCAL_PORT:-8081}"
PROD_HEALTH_REMOTE_PORT="${PROD_HEALTH_REMOTE_PORT:-18081}"
DEV_HEALTH_LOCAL_PORT="${DEV_HEALTH_LOCAL_PORT:-8082}"
DEV_HEALTH_REMOTE_PORT="${DEV_HEALTH_REMOTE_PORT:-18082}"
HEALTH_BIND_HOST="${HEALTH_BIND_HOST:-127.0.0.1}"
SSH_CONTROL_PATH="${SSH_CONTROL_PATH:-${TMPDIR:-/tmp}/liveclass-realtime-agent-%C.sock}"
TURN_SSH_CONTROL_PATH="${TURN_SSH_CONTROL_PATH:-${TMPDIR:-/tmp}/liveclass-realtime-agent-turn-%C.sock}"
PROD_HEALTH_REVERSE_MARKER="$SSH_CONTROL_PATH.health-$PROD_HEALTH_REMOTE_PORT"
DEV_HEALTH_REVERSE_MARKER="$SSH_CONTROL_PATH.health-$DEV_HEALTH_REMOTE_PORT"

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
if [ "$DEV_REDIS_LOCAL_PORT" = "$PROD_REDIS_LOCAL_PORT" ]; then
    echo "dev and prod Redis local ports must be different" >&2
    exit 1
fi
if [ "$DEV_HEALTH_LOCAL_PORT" = "$PROD_HEALTH_LOCAL_PORT" ]; then
    echo "dev and prod health local ports must be different" >&2
    exit 1
fi
if [ "$DEV_HEALTH_REMOTE_PORT" = "$PROD_HEALTH_REMOTE_PORT" ]; then
    echo "dev and prod health remote ports must be different" >&2
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
validate_port "$DEV_REDIS_LOCAL_PORT" DEV_REDIS_LOCAL_PORT
validate_port "$DEV_REDIS_REMOTE_PORT" DEV_REDIS_REMOTE_PORT
validate_port "$PROD_REDIS_LOCAL_PORT" PROD_REDIS_LOCAL_PORT
validate_port "$PROD_REDIS_REMOTE_PORT" PROD_REDIS_REMOTE_PORT
validate_port "$TURN_LOCAL_PORT" TURN_LOCAL_PORT
validate_port "$TURN_REMOTE_PORT" TURN_REMOTE_PORT
validate_port "$PROD_HEALTH_LOCAL_PORT" PROD_HEALTH_LOCAL_PORT
validate_port "$PROD_HEALTH_REMOTE_PORT" PROD_HEALTH_REMOTE_PORT
validate_port "$DEV_HEALTH_LOCAL_PORT" DEV_HEALTH_LOCAL_PORT
validate_port "$DEV_HEALTH_REMOTE_PORT" DEV_HEALTH_REMOTE_PORT

control_connection_exists() {
    ssh -F /dev/null -S "$SSH_CONTROL_PATH" -O check "$SSH_TARGET" >/dev/null 2>&1
}

turn_connection_exists() {
    ssh -F /dev/null -S "$TURN_SSH_CONTROL_PATH" -O check "$SSH_TARGET" >/dev/null 2>&1
}

ensure_local_forward() {
    local_port="$1"
    remote_port="$2"
    forward_name="$3"
    if ! nc -z -w 2 127.0.0.1 "$local_port"; then
        ssh -F /dev/null -S "$SSH_CONTROL_PATH" -O forward \
            -L "$local_port:localhost:$remote_port" "$SSH_TARGET"
    fi
    validate_managed_listener "$local_port" "$forward_name"
}

ensure_health_reverse() {
    local_port="$1"
    remote_port="$2"
    reverse_marker="$3"
    if [ ! -e "$reverse_marker" ]; then
        ssh -F /dev/null -S "$SSH_CONTROL_PATH" -O forward \
            -R "$HEALTH_BIND_HOST:$remote_port:127.0.0.1:$local_port" \
            "$SSH_TARGET"
        : >"$reverse_marker"
    fi
}

start_control_tunnel() {
    validate_listener_available "$LIVEKIT_LOCAL_PORT" LIVEKIT
    validate_listener_available "$DEV_REDIS_LOCAL_PORT" DEV_REDIS
    validate_listener_available "$PROD_REDIS_LOCAL_PORT" PROD_REDIS

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
        -L "$DEV_REDIS_LOCAL_PORT:localhost:$DEV_REDIS_REMOTE_PORT" \
        -L "$PROD_REDIS_LOCAL_PORT:localhost:$PROD_REDIS_REMOTE_PORT" \
        -R "$HEALTH_BIND_HOST:$PROD_HEALTH_REMOTE_PORT:127.0.0.1:$PROD_HEALTH_LOCAL_PORT" \
        -R "$HEALTH_BIND_HOST:$DEV_HEALTH_REMOTE_PORT:127.0.0.1:$DEV_HEALTH_LOCAL_PORT" \
        "$SSH_TARGET"
    : >"$PROD_HEALTH_REVERSE_MARKER"
    : >"$DEV_HEALTH_REVERSE_MARKER"
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
    ensure_local_forward "$LIVEKIT_LOCAL_PORT" "$LIVEKIT_REMOTE_PORT" LIVEKIT
    ensure_local_forward "$DEV_REDIS_LOCAL_PORT" "$DEV_REDIS_REMOTE_PORT" DEV_REDIS
    ensure_local_forward "$PROD_REDIS_LOCAL_PORT" "$PROD_REDIS_REMOTE_PORT" PROD_REDIS
    ensure_health_reverse \
        "$PROD_HEALTH_LOCAL_PORT" "$PROD_HEALTH_REMOTE_PORT" "$PROD_HEALTH_REVERSE_MARKER"
    ensure_health_reverse \
        "$DEV_HEALTH_LOCAL_PORT" "$DEV_HEALTH_REMOTE_PORT" "$DEV_HEALTH_REVERSE_MARKER"
else
    rm -f -- "$PROD_HEALTH_REVERSE_MARKER" "$DEV_HEALTH_REVERSE_MARKER"
    start_control_tunnel
    validate_managed_listener "$LIVEKIT_LOCAL_PORT" LIVEKIT
    validate_managed_listener "$DEV_REDIS_LOCAL_PORT" DEV_REDIS
    validate_managed_listener "$PROD_REDIS_LOCAL_PORT" PROD_REDIS
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
