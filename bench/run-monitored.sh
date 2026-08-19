#!/usr/bin/env bash
#
# 관측을 켠 채로 한 번 돌리고 그래프를 뜬다.
#
# **이 실행의 수치는 대표값이 아니다.** 관측 컨테이너 넷이 함께 도는데 lazy는 물리 4코어라
# 그 영향이 남는다. 대표 수치는 관측을 끄고 잰 값이고(bench/run-chains.sh), 여기서 얻는 것은
# 그 수치가 어떤 모양으로 흘러가는지다 — 두 구간의 CPU가 자리를 바꾸는 그림.
#
# 다른 스크립트와 달리 compose down으로 시작하지 않는다. 내리면 관측 컨테이너까지 사라져
# 스크레이프가 끊긴다.
#
# 사용법: bench/run-monitored.sh            팬아웃만
#         PHASE=both bench/run-monitored.sh  팬아웃 뒤에 발송까지
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
CHAINS="${CHAINS:-2}"
SLICE="${SLICE:-5000}"
CONCURRENCY="${CONCURRENCY:-8}"
PHASE="${PHASE:-fanout}"
OUT="${OUT:-$BENCH/results/monitored-$(date +%Y%m%dT%H%M%S)}"

PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"
INFRA_CPUSET_V="${INFRA_CPUSET:-3,7}"
APP_CPUSET_V="${APP_CPUSET:-2,6}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }

echo "▶ 인프라·관측 기동"
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 || fail "인프라 기동 실패"
# **exporter만 여기서 돈다.** Prometheus·Grafana·렌더러는 측정 머신 밖에서 돌린다
# (bench/monitoring/compose.remote.yml) — 관측을 같이 돌렸더니 팬아웃이 18.3초에서
# 20.976초로 늘었다. cAdvisor는 cgroup과 /var/lib/docker를 읽어야 해서 못 옮긴다.
MON_SERVICES="${MON_SERVICES:-postgres-exporter cadvisor}"
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose --profile mon up -d --wait --wait-timeout 300 $MON_SERVICES > /dev/null 2>&1 \
  || fail "관측 기동 실패"

USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS · 갈래 $CHAINS · 조각 $SLICE · 소비자 $CONCURRENCY"

echo "▶ 초기화"
pg -c "TRUNCATE core.notification, core.notification_content,
              core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
pg -c "CHECKPOINT;" > /dev/null
compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true
curl -s --max-time 5 http://127.0.0.1:18080/reset > /dev/null 2>&1 || true

PUSH_ON=false
[ "$PHASE" = "both" ] && PUSH_ON=true

compose rm -sf app > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" APP_CPUSET="$APP_CPUSET_V" \
APP_HEAP="${APP_HEAP:-1g}" APP_MEM="${APP_MEM:-1600m}" \
FANOUT_ENABLED=true PUSH_ENABLED="$PUSH_ON" FANOUT_CONCURRENCY="$CONCURRENCY" \
  compose up -d --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"

# 그래프 왼쪽에 조용한 구간을 남긴다 — 시작 지점이 보여야 읽힌다.
echo "▶ 기준선 20초"
sleep 20

echo "▶ 트리거 (갈래 $CHAINS)"
material="$(new_uuid)"
ranges="$(python3 -c "
import sys
n = int(sys.argv[1]); span = 1 << 128
def u(v):
    h = '%032x' % (v - 1)
    return '%s-%s-%s-%s-%s' % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
for i in range(n):
    print('%s|%s' % ('' if i == 0 else u(i * span // n),
                     '' if i == n - 1 else u((i + 1) * span // n)))
" "$CHAINS")"
c=0
START_MS="$(now_ms)"
while IFS='|' read -r lo hi; do
  c=$(( c + 1 ))
  after=$([ -n "$lo" ] && echo "\"$lo\"" || echo null)
  upto=$([ -n "$hi" ] && echo "\"$hi\"" || echo null)
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"00000000-0000-4000-8000-000000000002\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":$after,\"untilUserId\":$upto,\"sliceLimit\":$SLICE}'::jsonb,
                 'PENDING','mon:$material:$c',0,now(),now(),now());" > /dev/null
done <<< "$ranges"

prev=0; last_change=$(date +%s)
while :; do
  now=$(date +%s)
  cur="$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)"
  printf '\r   %4ss · %8s/%s   ' "$(( now - (START_MS / 1000) ))" "$cur" "$USERS"
  [ "$cur" -eq "$prev" ] || last_change=$now
  prev=$cur
  [ "$cur" -ge "$USERS" ] && break
  [ $(( now - last_change )) -ge 150 ] && { echo; echo "   정체"; break; }
  sleep 2
done
FANOUT_MS=$(( $(now_ms) - START_MS ))
echo
echo "   팬아웃 $(python3 -c "print($FANOUT_MS/1000)")초"

if [ "$PHASE" = "both" ]; then
  echo "▶ 발송 (큐를 비운다)"
  SUBS="$(pg -c 'SELECT count(*) FROM core.push_subscription;')"
  prev=0
  while :; do
    cur="$(curl -s --max-time 5 http://127.0.0.1:18080/stats 2>/dev/null \
           | python3 -c 'import sys,json;print(json.load(sys.stdin).get("total",0))' 2>/dev/null || echo 0)"
    printf '\r   발송 %8s/%s   ' "$cur" "$SUBS"
    [ "$cur" -ge "$SUBS" ] && break
    [ "$cur" -eq "$prev" ] && sleep 5 || sleep 3
    prev=$cur
  done
  echo
fi

END_MS="$(now_ms)"
# 그래프 오른쪽에도 조용한 구간을 남긴다.
echo "▶ 마무리 20초"
sleep 20

python3 - "$OUT" "$START_MS" "$END_MS" <<'PY'
import json, os, sys
out, start, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
# 앞뒤 여백을 넣은 구간. 스크린샷은 이 범위로 뜬다.
window = {"from": start - 25000, "to": end + 20000}
json.dump(window, open(os.path.join(out, "window.json"), "w"))
print("   그래프 구간 %d초" % ((window["to"] - window["from"]) / 1000))
PY

echo
echo "결과: $OUT"
echo "Grafana: http://127.0.0.1:13000/d/fanout-bench"
