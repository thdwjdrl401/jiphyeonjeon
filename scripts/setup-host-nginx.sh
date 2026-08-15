#!/bin/bash
# 집현전 호스트 nginx 엔트리 설치 (ADR-0126). root로 실행한다.
#
#   sudo bash ~/setup-host-nginx.sh
#
# 전제: jiphyeonjeon.thdwjdrl.com 의 A 레코드가 이 호스트(116.40.185.89)를 가리켜야 한다.
# Let's Encrypt가 그 주소로 검증하러 오기 때문에, DNS가 옛 서버를 가리키면 발급이 실패한다.
set -euo pipefail

DOMAIN=jiphyeonjeon.thdwjdrl.com
SRC="$(cd "$(dirname "$0")/.." && pwd)/infra/nginx/host-entry-jiphyeonjeon.conf"

echo "== 1. DNS 확인 =="
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)
MYIP=$(curl -s --max-time 10 ifconfig.me || echo unknown)
echo "   $DOMAIN → ${RESOLVED:-없음}"
echo "   이 호스트     → $MYIP"
if [ "$RESOLVED" != "$MYIP" ]; then
  echo "   ⚠️  일치하지 않는다. DNS를 먼저 바꾸고 전파를 기다려라 — 인증서 발급이 실패한다."
  exit 1
fi

echo "== 2. ACME 웹루트 =="
mkdir -p /var/www/certbot
chown -R www-data:www-data /var/www/certbot

echo "== 3. 인증서 발급 =="
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "   이미 있음 — 건너뜀"
else
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    -m thdwjdrl401@gmail.com
fi

echo "== 4. 사이트 설치 =="
install -m 644 "$SRC" /etc/nginx/sites-available/jiphyeonjeon
ln -sfn /etc/nginx/sites-available/jiphyeonjeon /etc/nginx/sites-enabled/jiphyeonjeon

echo "== 5. 문법 검사 후 반영 =="
nginx -t
systemctl reload nginx

echo
echo "== 완료 =="
echo "   https://$DOMAIN"
curl -s -o /dev/null -w "   응답: %{http_code}\n" "https://$DOMAIN" || true
