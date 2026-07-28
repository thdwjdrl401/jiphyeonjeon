#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "install.sh must run as root" >&2
    exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
UV_SOURCE="${1:-$(command -v uv || true)}"
if [ -z "$UV_SOURCE" ] || [ ! -x "$UV_SOURCE" ]; then
    echo "usage: install.sh /absolute/path/to/uv" >&2
    exit 2
fi

if ! id liveclass-ai >/dev/null 2>&1; then
    useradd --system --home-dir /srv/liveclass/realtime-agent --create-home \
        --shell /usr/sbin/nologin liveclass-ai
fi

install -d -o root -g root -m 0755 /srv/liveclass/realtime-agent
install -d -o liveclass-ai -g liveclass-ai /srv/liveclass/realtime-agent/cache/uv
install -d /etc/liveclass /usr/local/libexec /usr/local/sbin
if [ "$(readlink -f "$UV_SOURCE")" != /usr/local/bin/uv ]; then
    install -m 0755 "$UV_SOURCE" /usr/local/bin/uv
fi
install -m 0755 "$SCRIPT_DIR/bin/liveclass-realtime-agent-deploy" \
    /usr/local/sbin/liveclass-realtime-agent-deploy
install -m 0755 "$SCRIPT_DIR/bin/liveclass-realtime-agent-tunnels" \
    /usr/local/libexec/liveclass-realtime-agent-tunnels
install -m 0644 "$SCRIPT_DIR/systemd/liveclass-realtime-agent.service" \
    /etc/systemd/system/liveclass-realtime-agent.service
install -m 0644 "$SCRIPT_DIR/systemd/liveclass-realtime-agent-tunnels.service" \
    /etc/systemd/system/liveclass-realtime-agent-tunnels.service

if [ ! -e /etc/liveclass/realtime-agent.env ]; then
    install -m 0600 "$SCRIPT_DIR/env/realtime-agent.env.example" \
        /etc/liveclass/realtime-agent.env
fi
if [ ! -e /etc/liveclass/realtime-agent-tunnels.env ]; then
    install -m 0600 "$SCRIPT_DIR/env/realtime-agent-tunnels.env.example" \
        /etc/liveclass/realtime-agent-tunnels.env
fi

if id gitlab-runner >/dev/null 2>&1; then
    install -m 0440 "$SCRIPT_DIR/sudoers/liveclass-realtime-agent" \
        /etc/sudoers.d/liveclass-realtime-agent
    visudo -cf /etc/sudoers.d/liveclass-realtime-agent >/dev/null
else
    echo "gitlab-runner user is absent; install the sudoers file after runner registration" >&2
fi

systemctl daemon-reload
echo "edit /etc/liveclass/realtime-agent*.env, verify SSH known_hosts, then enable both services"
