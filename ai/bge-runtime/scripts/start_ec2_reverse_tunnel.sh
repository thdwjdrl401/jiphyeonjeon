#!/bin/sh
set -eu

: "${SSH_KEY:?SSH_KEY must point to a readable private key}"
: "${SSH_TARGET:?SSH_TARGET must be in user@host form}"

BGE_LOCAL_PORT="${BGE_LOCAL_PORT:-8020}"
BGE_EC2_PORT="${BGE_EC2_PORT:-18020}"
BGE_READY_TIMEOUT_SECONDS="${BGE_READY_TIMEOUT_SECONDS:-5}"

validate_port() {
    port_value="$1"
    port_name="$2"
    case "$port_value" in
        ''|*[!0-9]*)
            echo "$port_name must be an integer port" >&2
            exit 1
            ;;
    esac
    if [ "$port_value" -lt 1 ] || [ "$port_value" -gt 65535 ]; then
        echo "$port_name must be between 1 and 65535" >&2
        exit 1
    fi
}

validate_positive_integer() {
    integer_value="$1"
    integer_name="$2"
    case "$integer_value" in
        ''|*[!0-9]*)
            echo "$integer_name must be a positive integer" >&2
            exit 1
            ;;
    esac
    if [ "$integer_value" -lt 1 ]; then
        echo "$integer_name must be a positive integer" >&2
        exit 1
    fi
}

validate_port "$BGE_LOCAL_PORT" BGE_LOCAL_PORT
validate_port "$BGE_EC2_PORT" BGE_EC2_PORT
validate_positive_integer "$BGE_READY_TIMEOUT_SECONDS" BGE_READY_TIMEOUT_SECONDS

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

if [ ! -r "$SSH_KEY" ]; then
    echo "SSH key is not readable" >&2
    exit 1
fi

command -v ssh >/dev/null 2>&1 || {
    echo "ssh is required" >&2
    exit 1
}
command -v curl >/dev/null 2>&1 || {
    echo "curl is required" >&2
    exit 1
}

if ! curl -fsS --max-time "$BGE_READY_TIMEOUT_SECONDS" \
    "http://127.0.0.1:${BGE_LOCAL_PORT}/readyz" >/dev/null; then
    echo "local BGE runtime is not ready" >&2
    exit 1
fi

forward_spec="127.0.0.1:${BGE_EC2_PORT}:127.0.0.1:${BGE_LOCAL_PORT}"

exec ssh \
    -F /dev/null \
    -T -N \
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
    -R "$forward_spec" \
    "$SSH_TARGET"
