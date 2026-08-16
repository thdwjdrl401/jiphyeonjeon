#!/bin/bash
# 배포 호스트 방화벽 규칙. root로 실행한다.
#
#   sudo bash scripts/setup-host-firewall.sh
#
# 공유기 포워딩과 별개다. 공유기가 넘겨준 패킷을 호스트 ufw가 다시 한 번 막기 때문에,
# 둘 다 열려야 밖에서 들어온다.
set -euo pipefail

command -v ufw >/dev/null || { echo "ufw 없음 — 이 호스트는 다른 방화벽을 쓴다"; exit 1; }

echo "== 공개 포트 =="
# 웹(호스트 nginx). 이미 열려 있을 수 있으나 ufw allow는 멱등이다.
ufw allow 443/tcp                comment 'jiphyeonjeon https'
# LiveKit 시그널링(WSS). 이게 막히면 화상 강의 입장 자체가 안 된다.
ufw allow 7443/tcp               comment 'livekit signaling'
# LiveKit 미디어. 학교·사내망이 7000~7999를 막아 3478(STUN 표준 포트)을 쓴다(ADR-0078).
ufw allow 3478/udp               comment 'livekit rtc media'
# UDP가 막힌 클라이언트의 TCP 폴백.
ufw allow 7881/tcp               comment 'livekit tcp fallback'

echo "== 내부 전용 =="
# 유령 Egress 회수 중계. backend 컨테이너(브리지)가 호스트 네트워크의 중계를 부른다.
# 브리지 서브넷은 호스트마다 다르므로 실제 값을 읽어서 연다 — 전체 개방이 아니다.
SUBNET=$(docker network inspect liveclass_default \
           --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || true)
if [ -n "$SUBNET" ]; then
  ufw allow from "$SUBNET" to any port 9107 proto tcp comment 'egress-purger'
  echo "   $SUBNET → 9107/tcp"
else
  echo "   ⚠️ liveclass_default 네트워크를 찾지 못했다 — 앱 스택을 먼저 띄워라"
fi

echo
echo "== 현재 규칙 =="
ufw status numbered
