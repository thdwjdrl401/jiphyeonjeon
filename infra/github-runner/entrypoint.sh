#!/bin/bash
# 설정이 남아 있으면 그대로 쓰고, 없으면 등록한다.
#
# 등록 토큰은 1시간이면 만료된다. 설정을 볼륨에 남겨 두는 이유가 그것이다 — 재시작할 때마다
# 새 토큰을 요구하면 컨테이너가 자기 힘으로 못 일어난다. 한 번 등록해 두면 러너가 자기
# credential로 다시 붙는다.
set -euo pipefail

cd /home/runner/actions-runner

: "${GITHUB_REPO_URL:?GITHUB_REPO_URL 필요 (예: https://github.com/owner/repo)}"
RUNNER_NAME="${RUNNER_NAME:-$(hostname)}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64}"

if [ ! -f .runner ]; then
  : "${RUNNER_TOKEN:?최초 등록에는 RUNNER_TOKEN 필요 — gh api -X POST repos/<owner>/<repo>/actions/runners/registration-token --jq .token}"
  echo "== 러너 등록: $RUNNER_NAME ($RUNNER_LABELS) =="
  ./config.sh \
    --unattended \
    --url "$GITHUB_REPO_URL" \
    --token "$RUNNER_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABELS" \
    --work /home/runner/_work \
    --replace
else
  echo "== 기존 설정 사용: $(jq -r .agentName .runner 2>/dev/null || echo "$RUNNER_NAME") =="
fi

# SIGTERM에 잡을 중간에 끊지 않고 정리한다. compose down이 러너를 죽일 때 GitHub 쪽에
# offline으로 남지 않게 한다.
cleanup() {
  echo "== 종료 신호 — 러너 정지 =="
  kill -TERM "$RUNNER_PID" 2>/dev/null || true
  wait "$RUNNER_PID" 2>/dev/null || true
}
trap cleanup TERM INT

./run.sh &
RUNNER_PID=$!
wait "$RUNNER_PID"
