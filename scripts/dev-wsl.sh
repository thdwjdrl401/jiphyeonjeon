#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
cd "${project_root}"

if [[ ! -f .env ]]; then
  echo "[dev:wsl] .env 파일이 없습니다. 먼저 'cp .env.example .env'를 실행해 주세요." >&2
  exit 1
fi

# npm/Gradle도 Docker Compose와 동일한 루트 .env 값을 받도록 현재 셸에 export한다.
set -a
# shellcheck disable=SC1091
source .env
set +a

stt_enabled="${RECORDED_STT_ENABLED:-false}"
if [[ "${stt_enabled,,}" != "true" ]]; then
  echo "[dev:wsl] .env에 RECORDED_STT_ENABLED=true를 설정해 주세요." >&2
  exit 1
fi

exec concurrently -k -n FE,BE,WATCH -c green,blue,magenta \
  "npm run fe:dev" \
  "npm run be:dev:wsl" \
  "npm run be:watch:wsl"
