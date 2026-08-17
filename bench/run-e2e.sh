#!/usr/bin/env bash
#
# 전체 경로 측정 — 사건 발생부터 마지막 기기 발송까지 몇 초인가.
#
# 지금까지의 측정은 부분의 하한이었다. 암호화 CPU만(코어당 2,796건/s),
# 팬아웃 DB만(100만 행 23.9초). 여기서 처음으로 앱·브로커·HTTP가 다 붙는다.
#
# **트리거는 아웃박스 행 직접 삽입이다.** 자료 게시 API는 인증 세션과 에셋이 필요한데,
# 우리가 재려는 것은 알림 파이프라인이지 업로드 경로가 아니다. 아웃박스부터 시작하면
# 릴레이 → 팬아웃 워커 → 푸시 워커 → 발송이 전부 실제 코드로 돈다.
# (업무 트랜잭션과 리스너는 1초 미만이라 여기서 빠져도 결론이 바뀌지 않는다.)
#
# **완료 판정은 목 푸시 서버가 한다.** 앱이 "다 보냈다"고 말하는 것과 상대가 "다 받았다"는
# 것은 다르다. 받은 쪽을 세는 편이 정직하다.
#
# 사용법
#   bench/seed/run-seed.sh          # 먼저 시드 (100만)
#   bench/run-e2e.sh
#
#   PUSH_CRYPTO_THREADS=1 bench/run-e2e.sh    # 삭제법: 암호화 풀 끄기
#   PUSH_CONCURRENCY=1    bench/run-e2e.sh    # 푸시 소비자 1개
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
OUT="${OUT:-$BENCH/results/e2e-$(date +%Y%m%dT%H%M%S)}"
COMPOSE=(docker compose -f "$BENCH/compose.bench.yml")

STALL_SECONDS="${STALL_SECONDS:-90}"
MAX_SECONDS="${MAX_SECONDS:-1800}"

fail() { echo "실패: $*" >&2; exit 1; }

# GNU 전용 표현을 피한다 — date -Is·%3N 과 /proc/sys/kernel/random/uuid 는
# macOS에 없어 로컬 검증이 막힌다. 측정은 lazy에서 하지만 검증은 어디서든 돼야 한다.
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
mkdir -p "$OUT"

pg() { "${COMPOSE[@]}" exec -T -e PGPASSWORD=bench postgres \
         psql -U liveclass -d liveclass -qtA "$@"; }
mock() { curl -s --max-time 5 "http://127.0.0.1:18080$1"; }

# ── 사전 검사 ─────────────────────────────────────────────────────────────
#
# SKIP_ISOLATION=1 은 **하네스가 동작하는지 확인할 때만** 쓴다. 다른 컨테이너가 도는
# 노트북에서 스크립트를 검증하려면 필요하지만, 그 실행의 수치는 측정이 아니다.
# 그래서 지문과 결과 배너에 표시를 남긴다 — 우회한 실행이 나중에 측정으로 오인되면
# 통제를 걸어 둔 의미가 사라진다.
ISOLATED=true
if [ "${SKIP_ISOLATION:-0}" = "1" ]; then
  ISOLATED=false
  echo "⚠ 격리 검사를 건너뛴다 (SKIP_ISOLATION=1). 이 실행은 하네스 검증용이며 측정이 아니다."
else
  others="$(docker ps --format '{{.Names}}' | grep -v '^liveclass-bench' || true)"
  [ -z "$others" ] || fail "벤치 외 컨테이너가 떠 있다: $(echo "$others" | paste -sd, -)
  측정이 목적이면 내려라. 하네스 검증만 할 거면 SKIP_ISOLATION=1."

  [ -r /proc/meminfo ] || fail "리눅스가 아니다. 측정은 lazy에서 한다 (SKIP_ISOLATION=1로 검증만 가능)."
  swap_used=$(( $(awk '/^SwapTotal:/{print $2}' /proc/meminfo) - $(awk '/^SwapFree:/{print $2}' /proc/meminfo) ))
  [ "$swap_used" -eq 0 ] || fail "스왑 사용 중. swapoff -a 후 재시도."

  for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    [ -r "$g" ] || continue
    [ "$(cat "$g")" = "performance" ] || fail "$g 가 performance가 아니다."
  done
fi

# ── 기동 ─────────────────────────────────────────────────────────────────
# 순서가 있다. 앱이 뜨면서 Flyway가 스키마를 만들고, 그다음에 시드를 넣는다.
# 시드를 먼저 넣을 수 없다 — 넣을 표가 없다.
echo "▶ 스택 기동 (빌드 포함)"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 600 2>&1 | tail -5

echo "▶ 스키마·시드 확인"
subs="$(pg -c 'SELECT count(*) FROM core.push_subscription;' 2>/dev/null || echo 0)"
if [ "${subs:-0}" -eq 0 ]; then
  # 볼륨이 비었다(첫 실행). 여기서 채운다 — 이후 실행은 볼륨이 남아 건너뛴다.
  echo "   비어 있다 → 시드 (${SEED_USERS:-1000000}명, 수 분 소요)"
  "${COMPOSE[@]}" cp "$BENCH/seed/seed.sql" postgres:/tmp/seed.sql
  "${COMPOSE[@]}" exec -T -e PGPASSWORD=bench postgres \
    psql -U liveclass -d liveclass -v users="${SEED_USERS:-1000000}" -f /tmp/seed.sql \
    2>&1 | grep -E "INSERT|시드 결과|^ *[0-9]" | tail -6
  subs="$(pg -c 'SELECT count(*) FROM core.push_subscription;')"
fi
[ "${subs:-0}" -gt 0 ] || fail "시드에 실패했다."
echo "   구독 $subs 건"

# ── 초기화 ────────────────────────────────────────────────────────────────
echo "▶ 초기화"
pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
              core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
pg -c "CHECKPOINT;" > /dev/null
mock /reset > /dev/null || true
# 큐에 남은 게 있으면 이번 측정에 섞인다.
"${COMPOSE[@]}" exec -T rabbitmq rabbitmqctl purge_queue notification.fanout > /dev/null 2>&1 || true
"${COMPOSE[@]}" exec -T rabbitmq rabbitmqctl purge_queue notification.push   > /dev/null 2>&1 || true

# ── 지문 ─────────────────────────────────────────────────────────────────
{
  echo "{"
  echo "  \"startedAt\": \"$(iso_now)\","
  echo "  \"gitSha\": \"$(git -C "$REPO_ROOT" rev-parse HEAD)\","
  echo "  \"kernel\": \"$(uname -r)\", \"arch\": \"$(uname -m)\","
  echo "  \"cpuModel\": \"$(awk -F': ' '/model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null || echo unknown)\","
  echo "  \"isolated\": $ISOLATED,"
  echo "  \"subscriptions\": $subs,"
  echo "  \"knobs\": {"
  echo "    \"pushCryptoThreads\": \"${PUSH_CRYPTO_THREADS:-0}\","
  echo "    \"pushMaxInFlight\": \"${PUSH_MAX_IN_FLIGHT:-800}\","
  echo "    \"pushConcurrency\": \"${PUSH_CONCURRENCY:-2}\","
  echo "    \"fanoutConcurrency\": \"${FANOUT_CONCURRENCY:-2}\","
  echo "    \"relayDelayMs\": \"${RELAY_DELAY_MS:-5000}\","
  echo "    \"mockDelay\": \"${MOCK_DELAY:-50ms}\""
  echo "  }"
  echo "}"
} > "$OUT/fingerprint.json"

# ── 트리거 ────────────────────────────────────────────────────────────────
material="$(new_uuid)"
payload=$(cat <<JSON
{"type":"MATERIAL_PUBLISHED",
 "curriculumId":"00000000-0000-4000-8000-000000000002",
 "curriculumTitle":"벤치 커리큘럼",
 "lessonId":"00000000-0000-4000-8000-000000000004",
 "materialId":"$material","subjectName":"3주차.pptx",
 "occurredAt":"$(iso_now)","sliceLimit":1000}
JSON
)

echo "▶ 트리거 (material=$material)"
t0=$(now_ms)
pg -c "INSERT INTO core.outbox_events
        (aggregate_type, aggregate_id, event_type, destination, payload_json,
         status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
               '$(echo "$payload" | tr -d '\n')'::jsonb,'PENDING','bench:$material',0,now(),now(),now());" > /dev/null

# ── 진행 감시 ─────────────────────────────────────────────────────────────
echo "▶ 진행 (완료 = 목 푸시 수신 $subs 건)"
printf 'elapsed_s,notifications,push_received,push_delta,rate_now,queue_fanout,queue_push,cpu_app,cpu_pg,cpu_mq,cpu_mock,mem_app\n' > "$OUT/progress.csv"

last_total=0; last_change=$(date +%s)      # 정체 감지 전용
prev_total=0; prev_at=$(date +%s)          # 처리율 전용
done_at=""
while :; do
  now=$(date +%s); elapsed=$(( now - (t0 / 1000) ))
  stats="$(mock /stats || echo '{}')"
  total=$(echo "$stats" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("total",0))' 2>/dev/null || echo 0)
  rate=$(echo "$stats" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("ratePerSecond",0))' 2>/dev/null || echo 0)
  rows=$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)
  qf=$("${COMPOSE[@]}" exec -T rabbitmq rabbitmqctl list_queues -q name messages 2>/dev/null | awk '$1=="notification.fanout"{print $2}')
  qp=$("${COMPOSE[@]}" exec -T rabbitmq rabbitmqctl list_queues -q name messages 2>/dev/null | awk '$1=="notification.push"{print $2}')

  # 컨테이너별 CPU. 첫 실행에서 병목(Postgres 202% · 앱 8.9%)을 찾으려고
  # docker stats를 따로 봐야 했다. 기록에 있으면 결과만 보고 안다.
  st="$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemPerc}}' 2>/dev/null || true)"
  pick() { echo "$st" | awk -v k="$1" '$0 ~ k {gsub("%","",$2); print $2; exit}'; }
  pickm() { echo "$st" | awk -v k="$1" '$0 ~ k {gsub("%","",$3); print $3; exit}'; }

  # 순간 처리율. 목 서버의 ratePerSecond는 **누적 평균**이라 실제로 느려지는 구간에서도
  # 완만하게만 내려가 오해를 부른다(첫 실행에서 2,225/s로 보였지만 순간값은 275/s였다).
  delta=$(( total - prev_total ))
  gap=$(( now - prev_at )); [ "$gap" -gt 0 ] || gap=1
  rate_now=$(( delta / gap ))
  prev_total=$total; prev_at=$now

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$elapsed" "$rows" "$total" "$delta" "$rate_now" \
    "${qf:-0}" "${qp:-0}" "$(pick app)" "$(pick postgres)" "$(pick rabbitmq)" "$(pick mock)" "$(pickm app)" \
    >> "$OUT/progress.csv"
  printf '\r   %4ss · 알림 %7s · 발송 %7s · 지금 %5s/s · 큐 f=%s p=%-4s · CPU 앱 %s%% pg %s%%      ' \
    "$elapsed" "$rows" "$total" "$rate_now" "${qf:-0}" "${qp:-0}" "$(pick app)" "$(pick postgres)"

  if [ "$total" -ge "$subs" ]; then done_at=$(now_ms); break; fi
  if [ "$total" != "$last_total" ]; then last_total=$total; last_change=$now; fi
  if [ $(( now - last_change )) -ge "$STALL_SECONDS" ]; then
    echo; echo "   진행이 ${STALL_SECONDS}초간 멈췄다 — 부분 결과로 종료"; break
  fi
  if [ "$elapsed" -ge "$MAX_SECONDS" ]; then echo; echo "   상한 도달"; break; fi
  sleep 2
done
echo

t1="${done_at:-$(now_ms)}"
wall=$(python3 -c "print(f'{($t1 - $t0)/1000:.1f}')")

# ── 결과 ─────────────────────────────────────────────────────────────────
mock /stats > "$OUT/mock-stats.json"
curl -s --max-time 5 http://127.0.0.1:18081/actuator/metrics > "$OUT/app-metrics-index.json" 2>/dev/null || true
"${COMPOSE[@]}" logs --no-color app > "$OUT/app.log" 2>&1 || true
pg -c "SELECT 'notification', count(*) FROM core.notification
       UNION ALL SELECT 'dedupe', count(*) FROM core.notification_dedupe
       UNION ALL SELECT 'content', count(*) FROM core.notification_content
       UNION ALL SELECT 'push_progress', count(*) FROM core.notification_push_progress
       UNION ALL SELECT 'outbox_published', count(*) FROM core.outbox_events WHERE status='PUBLISHED';" \
  > "$OUT/db-counts.txt"

echo "══ 결과 ══"
[ "$ISOLATED" = "true" ] || echo "  ⚠ 격리 검사를 건너뛴 실행이다. 수치를 측정으로 인용하지 말 것."
echo "  전체 소요            ${wall}초   (사건 → 마지막 발송)"
python3 - "$OUT/mock-stats.json" "$subs" "$wall" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); subs = int(sys.argv[2]); wall = float(sys.argv[3])
print(f"  목 푸시 수신          {d['total']:,} / {subs:,}")
print(f"    성공 {d['delivered']:,} · 429 {d['tooMany']:,} · 5xx {d['serverError']:,} · 410 {d['gone']:,}")
print(f"  발송 처리율           {d['ratePerSecond']:,.0f} 건/s")
print(f"  목 서버 최대 동시     {d['maxInFlight']:,}   ← 클라이언트가 실제로 낸 동시성")
if wall > 0:
    print(f"  전체 기준 처리율      {d['total']/wall:,.0f} 건/s")
print()
print("  60초 목표 " + ("달성" if wall <= 60 else f"미달 — {wall/60:.1f}배 초과"))
PY
cat "$OUT/db-counts.txt"
echo
echo "결과: $OUT"
