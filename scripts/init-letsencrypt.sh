#!/usr/bin/env bash
# Let's Encrypt 인증서 최초 발급 (EC2, 최초 1회).
# nginx가 아직 안 떠 있는 상태에서 certbot standalone(포트 80)으로 발급 →
# 이후 정상 기동. 갱신은 certbot 서비스가 webroot로 자동 처리(docker-compose.prod.yml).
#
# 사전: .env.prod 작성, Security Group 80 개방(외부 도달), DNS가 이 서버를 가리킴.
# 실행: bash scripts/init-letsencrypt.sh
set -euo pipefail

DOMAIN="jiphyeonjeon.thdwjdrl.com"
EMAIL="change-me@example.com"     # ← 본인 이메일 (만료 알림 수신). --register 시 사용
STAGING=0                          # 1이면 LE 스테이징(테스트, rate-limit 회피). 검증 후 0으로.

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.prod)

if [ ! -f .env.prod ]; then
  echo "[에러] .env.prod 없음 → cp .env.prod.example .env.prod 후 값 채우기" >&2
  exit 1
fi

# 이미 발급돼 있으면 skip
if "${COMPOSE[@]}" run --rm --entrypoint sh certbot -c "[ -d /etc/letsencrypt/live/$DOMAIN ]" 2>/dev/null; then
  echo "[skip] 인증서가 이미 존재합니다: $DOMAIN"
  echo "  → 곧바로: ${COMPOSE[*]} up -d --build"
  exit 0
fi

STAGING_FLAG=""
[ "$STAGING" != "0" ] && STAGING_FLAG="--staging"

echo "[1/2] standalone 방식으로 $DOMAIN 인증서 발급 (포트 80 사용, nginx 미기동 상태)"
"${COMPOSE[@]}" run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone \
  -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email \
  --non-interactive $STAGING_FLAG

echo "[2/2] 발급 완료. 이제 전체 스택을 기동하세요:"
echo "  ${COMPOSE[*]} up -d --build"
