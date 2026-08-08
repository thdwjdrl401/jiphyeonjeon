#!/usr/bin/env bash
# 프로젝트 스택 아이콘을 내려받아 PNG로 굽는다.
#
# 왜 별도 디렉토리인가
#   docs/architecture/infrastructure-diagram/icons/ 에도 아이콘이 있지만 그쪽은 **흑백 SVG**이고
#   build_infrastructure_official.py 가 그 색 없음에 의존해 자기 팔레트를 입힌다. 여기 것은 발표·문서용
#   **브랜드 컬러** 사본이라 용도가 다르다. 섞으면 다이어그램 빌드가 깨진다.
#
# 출처와 라이선스
#   Simple Icons(https://simpleicons.org) — 아이콘 데이터는 CC0-1.0, 다만 **상표권은 각 브랜드 소유**다.
#   브랜드 가이드라인을 벗어난 사용(변형·재배색·후원 암시)은 별개 문제이니 쓰기 전에 확인한다.
#   AWS 마크만 예외로 AWS Architecture Icons 원본을 쓴다 — Simple Icons가 상표 요청으로 내렸다.
#
# 사용법
#   bash docs/assets/tech-icons/fetch-icons.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVG_DIR="$ROOT/svg"
PNG_DIR="$ROOT/png"
SIZE="${ICON_SIZE:-512}"
# 흑백 SVG 원본(다이어그램용)에서 AWS 마크만 빌려 온다. 그쪽은 읽기만 한다.
AWS_SRC="$ROOT/../../architecture/infrastructure-diagram/icons/official/aws/amazon-ec2.svg"

# 슬러그는 Simple Icons 기준. 실제로 프로젝트에서 쓰는 것만 넣는다 — 안 쓰는 걸 넣으면 스택을 속인다.
SLUGS=(
  # 언어·런타임
  openjdk python typescript nodedotjs
  # 백엔드
  springboot springsecurity hibernate flyway gradle swagger jsonwebtokens prometheus
  # 데이터·메시징
  postgresql redis rabbitmq minio
  # 프론트엔드
  react vite vitest excalidraw axios reactquery reactrouter webrtc
  # AI
  fastapi huggingface nvidia pytorch sqlalchemy pydantic
  # 인프라
  docker nginx livekit letsencrypt ffmpeg ubuntu gitlab
  # 협업
  jira
)

mkdir -p "$SVG_DIR" "$PNG_DIR"

echo "== SVG 내려받기 (${#SLUGS[@]}개)"
missing=()
for slug in "${SLUGS[@]}"; do
  # 색 없이 받으면 검정 단색이라 PNG로 구웠을 때 브랜드 식별이 안 된다. 기본값이 브랜드 컬러다.
  if curl -fsS --max-time 20 "https://cdn.simpleicons.org/$slug" -o "$SVG_DIR/$slug.svg"; then
    printf '  %-16s ok\n' "$slug"
  else
    rm -f "$SVG_DIR/$slug.svg"
    missing+=("$slug")
    printf '  %-16s 실패\n' "$slug"
  fi
done

if [ -f "$AWS_SRC" ]; then
  cp "$AWS_SRC" "$SVG_DIR/amazon-ec2.svg"
  echo "  amazon-ec2       ok (AWS 공식 원본에서 복사)"
else
  missing+=("amazon-ec2")
fi

echo
echo "== PNG 변환 (${SIZE}px, 투명 배경)"
node "$ROOT/to-png.mjs" "$SVG_DIR" "$PNG_DIR" "$SIZE"

if [ ${#missing[@]} -gt 0 ]; then
  echo
  echo "받지 못한 것: ${missing[*]}"
  exit 1
fi
