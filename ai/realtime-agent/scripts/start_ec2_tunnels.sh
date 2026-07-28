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

ensure_tunnel() {
    tunnel_local_port="$1"
    tunnel_remote_port="$2"
    tunnel_name="$3"
    validate_port "$tunnel_local_port" "${tunnel_name}_LOCAL_PORT"
    validate_port "$tunnel_remote_port" "${tunnel_name}_REMOTE_PORT"

    if nc -z -w 2 127.0.0.1 "$tunnel_local_port"; then
        echo "$tunnel_name tunnel is already listening on localhost:$tunnel_local_port"
        return
    fi

    ssh \
        -i "$SSH_KEY" \
        -o BatchMode=yes \
        -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=30 \
        -o ServerAliveCountMax=3 \
        -f -N \
        -L "$tunnel_local_port:localhost:$tunnel_remote_port" \
        "$SSH_TARGET"
    nc -z -w 5 127.0.0.1 "$tunnel_local_port"
    echo "$tunnel_name tunnel started on localhost:$tunnel_local_port"
}

ensure_tunnel "$LIVEKIT_LOCAL_PORT" "$LIVEKIT_REMOTE_PORT" LIVEKIT
ensure_tunnel "$REDIS_LOCAL_PORT" "$REDIS_REMOTE_PORT" REDIS
ensure_tunnel "$TURN_LOCAL_PORT" "$TURN_REMOTE_PORT" TURN_TCP
