#!/bin/bash
# 노트북에서 실시간 STT 에이전트를 띄운다.
#
#   cp deploy/env/realtime-agent-laptop.env.example deploy/env/laptop.env
#   # LIVEKIT_API_KEY / LIVEKIT_API_SECRET 채우기 (배포 호스트의 livekit/CREDENTIALS.txt)
#   bash deploy/run-laptop.sh
#
# Redis 터널을 함께 연다. 자막 스트림이 배포 호스트 루프백에만 열려 있어서다.
# 나머지(LiveKit 시그널링·미디어)는 공개 경로로 직접 간다 — 터널 필요 없음.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${1:-deploy/env/laptop.env}"
SSH_HOST="${LIVECLASS_SSH_HOST:-lazy}"

[ -f "$ENV_FILE" ] || { echo "env 파일 없음: $ENV_FILE"; exit 1; }
command -v uv >/dev/null || { echo "uv 필요"; exit 1; }

if ! nvidia-smi >/dev/null 2>&1; then
  echo "⚠️  nvidia-smi가 없다. nemotron provider는 CUDA를 요구한다."
  echo "    GPU 없이 돌리려면 STT_ENGINE_PROVIDER=openai-realtime 로 바꾸고 OPENAI_API_KEY를 넣어라."
  exit 1
fi

# 이미 열려 있으면 다시 열지 않는다.
if ! nc -z 127.0.0.1 6390 2>/dev/null; then
  echo "== Redis 터널 여는 중 ($SSH_HOST) =="
  ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
      -L 6390:127.0.0.1:6390 "$SSH_HOST"
  for i in $(seq 1 20); do nc -z 127.0.0.1 6390 2>/dev/null && break; sleep 1; done
fi
nc -z 127.0.0.1 6390 2>/dev/null || { echo "터널 실패 — Redis에 닿지 않는다"; exit 1; }
echo "   Redis 터널 OK"

echo "== 의존성 =="
uv sync --frozen --extra nemotron

echo "== 에이전트 시작 =="
set -a; . "$ENV_FILE"; set +a
exec uv run --frozen python -m app.main
