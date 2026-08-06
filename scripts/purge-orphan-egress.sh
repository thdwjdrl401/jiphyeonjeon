#!/usr/bin/env bash
# 유령 Egress 회수 — LiveKit이 정지시킬 수 없는 작업 기록을 사람이 직접 걷어낸다.
#
# 왜 필요한가
#   Egress 작업은 그것을 시작한 핸들러 **프로세스**가 소유한다. 녹화 도중 egress 컨테이너가
#   재시작되면 그 프로세스가 완료 보고 없이 사라지고, LiveKit은 작업을 계속 진행 중으로 들고 있다.
#   StopEgress는 소유 핸들러에게 보내는 RPC라 받아 줄 상대가 없어 3초 뒤 타임아웃한다.
#
#     WARN  psrpc.EgressHandler.StopEgress  "error": "no response from servers"
#     INFO  API Egress.StopEgress  status 408  "request timed out"
#
#   LiveKit에 고아를 회수하는 API가 없어서, 운영 콘솔의 정지 버튼으로도 영영 걷히지 않는다.
#   남는 방법은 LiveKit Redis의 기록을 직접 지우는 것뿐이다. 2026-08-05에 두 호스트에서
#   각각 한 건씩 생겨 손으로 지웠고, 그 절차를 그대로 스크립트로 굳힌 것이 이 파일이다(ADR-0082 후속).
#
# 왜 앱이 아니라 스크립트인가
#   LiveKit Redis는 `--bind 127.0.0.1` + host 네트워크라 EC2 로컬에서만 닿는다. 백엔드 컨테이너는
#   브리지(liveclass_default)에 있어 경로가 없고, 뚫으려면 인증 없는 제어 평면을 같은 브리지의
#   모든 컨테이너에 여는 셈이 된다(requirepass가 비어 있다). 그 대가로 얻는 것이 버튼 한 번이라
#   지금은 사람이 EC2에서 실행하는 쪽을 택했다.
#
# 안전 장치 — **유령임을 확인하기 전에는 아무것도 지우지 않는다.**
#   진행 중인 녹화의 기록을 지우면 그 녹화는 완료 보고를 할 곳을 잃는다. 그래서 StopEgress를 먼저
#   보내고, 그 응답이 "소유자가 없다"(deadline_exceeded)일 때만 진행한다. 정지에 성공했다면 그것은
#   유령이 아니라 살아 있던 작업이므로 지우지 않고 LiveKit이 스스로 정리하게 둔다.
#
# 사용법 (EC2에서)
#   ssh ec2
#   bash scripts/purge-orphan-egress.sh EG_xxxx [EG_yyyy ...]
#
# 되돌리기
#   지우기 전에 각 기록을 ~/egress-orphan-backup/<egressId>-<timestamp>.txt 로 남긴다.
set -euo pipefail

CREDENTIALS_FILE="${LIVEKIT_CREDENTIALS_FILE:-/etc/liveclass/livekit/egress.yaml}"
REDIS_CONTAINER="${LIVEKIT_REDIS_CONTAINER:-livekit-redis-1}"
# TLS 종단(nginx-livekit) 뒤의 평문 포트. 도메인으로 붙으면 hairpin이고, 127.0.0.1:7443은
# 인증서에 IP SAN이 없어 검증에 실패한다 — 로컬에서는 7880이 정답이다.
LIVEKIT_URL="${LIVEKIT_URL:-http://127.0.0.1:7880}"
CLI_IMAGE="${LIVEKIT_CLI_IMAGE:-livekit/livekit-cli}"
BACKUP_DIR="${EGRESS_BACKUP_DIR:-$HOME/egress-orphan-backup}"

die() { echo "오류: $*" >&2; exit 1; }

[ $# -gt 0 ] || die "사용법: $(basename "$0") <egressId> [egressId ...]"
command -v docker >/dev/null || die "docker가 필요하다. 이 스크립트는 EC2에서 실행한다."
docker inspect "$REDIS_CONTAINER" >/dev/null 2>&1 \
  || die "LiveKit Redis 컨테이너를 찾을 수 없다: $REDIS_CONTAINER"

read_credential() {  # $1 = 키 이름. sudo 없이 읽히면 그대로, 아니면 sudo로.
  local key="$1"
  sed -nE "s/^${key}:[[:space:]]*(\S+).*/\1/p" "$CREDENTIALS_FILE" 2>/dev/null \
    || sudo sed -nE "s/^${key}:[[:space:]]*(\S+).*/\1/p" "$CREDENTIALS_FILE"
}

API_KEY="$(read_credential api_key)"
API_SECRET="$(read_credential api_secret)"
[ -n "$API_KEY" ] && [ -n "$API_SECRET" ] || die "$CREDENTIALS_FILE 에서 api_key/api_secret을 읽지 못했다"

redis() { docker exec "$REDIS_CONTAINER" redis-cli "$@"; }

lk() {
  docker run --rm --network host \
    -e LIVEKIT_URL="$LIVEKIT_URL" -e LIVEKIT_API_KEY="$API_KEY" -e LIVEKIT_API_SECRET="$API_SECRET" \
    "$CLI_IMAGE" "$@" 2>&1
}

# 방 인덱스(egress:room:<room>)에서도 뺀다. 안 빼면 빈 껍데기가 남아 다음 조회를 헷갈리게 한다.
purge_room_index() {
  local egress_id="$1" key members
  while read -r key; do
    [ -n "$key" ] || continue
    members="$(redis smembers "$key" | tr '\n' ' ')"
    case " $members " in
      *" $egress_id "*)
        redis srem "$key" "$egress_id" >/dev/null
        if [ "$(redis scard "$key")" = "0" ]; then
          redis del "$key" >/dev/null
          echo "    방 인덱스 삭제 $key (비어서)"
        else
          echo "    방 인덱스에서 제거 $key"
        fi
        ;;
    esac
  done < <(redis --scan --pattern 'egress:room:*')
}

mkdir -p "$BACKUP_DIR"
purged=0; skipped=0

for egress_id in "$@"; do
  echo "== $egress_id"

  if [ "$(redis hexists egress "$egress_id")" != "1" ]; then
    echo "  기록이 없다 — 이미 정리됨. 건너뛴다."
    skipped=$((skipped + 1))
    continue
  fi

  echo "  StopEgress로 소유자 확인 중…"
  stop_output="$(lk egress stop --id "$egress_id" || true)"

  case "$stop_output" in
    *deadline_exceeded*|*"request timed out"*)
      echo "  → 소유자가 응답하지 않는다. 유령으로 확정."
      ;;
    *failed_precondition*)
      echo "  → 이미 종료 상태다(진행 중 목록에 뜨지 않는다). 지우지 않는다."
      skipped=$((skipped + 1)); continue
      ;;
    *not_found*)
      # Redis에는 있는데 API는 모른다 — 우리가 이해하지 못한 상태다. 손대지 않는다.
      echo "  → LiveKit이 이 작업을 모른다. 기록과 어긋나므로 사람이 확인해야 한다."
      skipped=$((skipped + 1)); continue
      ;;
    *[Ee]rror*)
      echo "  → 정지 요청이 예상 밖으로 실패했다:"; echo "$stop_output" | sed 's/^/     /'
      skipped=$((skipped + 1)); continue
      ;;
    *)
      echo "  → 정지에 성공했다. 유령이 아니라 살아 있던 작업이므로 지우지 않는다."
      echo "     (LiveKit이 곧 종료 처리한다. 콘솔을 새로고침해 확인한다.)"
      skipped=$((skipped + 1)); continue
      ;;
  esac

  backup="$BACKUP_DIR/${egress_id}-$(date +%Y%m%d-%H%M%S).txt"
  redis --no-raw hget egress "$egress_id" > "$backup"
  echo "  백업 $backup ($(wc -c < "$backup")B)"

  redis hdel egress "$egress_id" >/dev/null
  purge_room_index "$egress_id"

  if [ "$(redis hexists egress "$egress_id")" = "0" ]; then
    echo "  삭제 완료."
    purged=$((purged + 1))
  else
    die "삭제했는데 기록이 남아 있다: $egress_id"
  fi
done

echo
echo "정리 $purged건 · 건너뜀 $skipped건"
[ "$purged" -gt 0 ] && echo "운영 콘솔을 새로고침하면 목록에서 사라진다."
exit 0
