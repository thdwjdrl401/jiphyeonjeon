#!/bin/sh
set -eu

RUNNER_RELEASE="${1:-latest}"
BIN_DIR="${LIVECLASS_USER_PREFIX:-$HOME/.local}/bin"
DOWNLOAD_ROOT=https://gitlab-runner-downloads.s3.amazonaws.com

case "$(uname -m)" in
    x86_64)
        runner_arch=amd64
        ;;
    aarch64|arm64)
        runner_arch=arm64
        ;;
    *)
        echo "unsupported architecture: $(uname -m)" >&2
        exit 1
        ;;
esac
case "$RUNNER_RELEASE" in
    latest)
        release_path=latest
        ;;
    v[0-9]*)
        release_path=$RUNNER_RELEASE
        ;;
    [0-9]*)
        release_path=v$RUNNER_RELEASE
        ;;
    *)
        echo "runner version must be latest or a numeric release such as 18.2.1" >&2
        exit 2
        ;;
esac

tmp_dir="$(mktemp -d)"
cleanup() {
    rm -rf -- "$tmp_dir"
}
trap cleanup EXIT HUP INT TERM

curl --fail --location --silent --show-error \
    "$DOWNLOAD_ROOT/$release_path/binaries/gitlab-runner-linux-$runner_arch" \
    --output "$tmp_dir/gitlab-runner"
chmod 0755 "$tmp_dir/gitlab-runner"
"$tmp_dir/gitlab-runner" --version
install -d -m 0755 "$BIN_DIR"
install -m 0755 "$tmp_dir/gitlab-runner" "$BIN_DIR/gitlab-runner"
echo "installed $BIN_DIR/gitlab-runner"
