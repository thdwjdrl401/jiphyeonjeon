#!/usr/bin/env bash
#
# 구간을 나눠 잰다 — 팬아웃과 발송을 따로.
#
# **왜 나누나.** 두 구간은 병목도 다르고(DB 대 앱 CPU) 확장 성질도 다르다
# (팬아웃은 조각 체인이 직렬이라 스케일아웃이 안 되고, 발송은 competing consumer라 된다).
# 한 머신에서 동시에 돌리면 서로 코어를 훔쳐 어느 쪽 수치도 그 구간의 실력이 아니다.
# 실제 배치도 푸시 워커를 별도 인스턴스로 두는 것이 전제다.
#
#   구간 A 팬아웃   푸시 소비 정지 → 알림 100만 행 생성 + 큐에 명령 1,000건 적재
#   구간 B 발송     팬아웃 소비 정지 → 쌓인 큐를 비우는 시간
#
# **앱은 두 구간 모두 물리 2코어**로 고정한다. 그래야 "앱 2코어짜리 머신 한 대"라는
# 단위가 서고, 거기서 필요한 서버 대수를 역산할 수 있다.
#
# 사용법
#   bench/run-phases.sh            # A → B 연속
#   PHASE=A bench/run-phases.sh    # 구간 A만
#   PHASE=B bench/run-phases.sh    # 구간 B만 (큐가 이미 차 있어야 한다)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
OUT="${OUT:-$BENCH/results/phases-$(date +%Y%m%dT%H%M%S)}"
PHASE="${PHASE:-AB}"
STALL_SECONDS="${STALL_SECONDS:-120}"

# 앱 코어는 두 구간 공통. 이 값이 역산의 단위다.
APP_CORES_PHYSICAL="${APP_CORES_PHYSICAL:-2}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"

now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }

compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
# < /dev/null 이 핵심이다. docker compose exec는 stdin을 컨테이너로 넘기므로,
# while read 루프 안에서 부르면 남은 입력을 먹어 반복이 한 번만 돈다.
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
mock() { curl -s --max-time 5 "http://127.0.0.1:18080$1"; }
qdepth() { compose exec -T rabbitmq rabbitmqctl list_queues -q name messages 2>/dev/null < /dev/null \
             | awk -v q="$1" '$1==q{print $2}'; }

# ── 격리 ──────────────────────────────────────────────────────────────────
ISOLATED=true
if [ "${SKIP_ISOLATION:-0}" = "1" ]; then
  ISOLATED=false
  echo "⚠ 격리 검사를 건너뛴다. 하네스 검증용이며 측정이 아니다."
else
  others="$(docker ps --format '{{.Names}}' | grep -v '^liveclass-bench' || true)"
  [ -z "$others" ] || fail "벤치 외 컨테이너: $(echo "$others" | paste -sd, -)"
  [ -r /proc/meminfo ] || fail "리눅스가 아니다."
  [ $(( $(awk '/^SwapTotal:/{print $2}' /proc/meminfo) - $(awk '/^SwapFree:/{print $2}' /proc/meminfo) )) -eq 0 ] \
    || fail "스왑 사용 중."
fi

# ── 구간 실행기 ───────────────────────────────────────────────────────────
# $1 라벨 · $2 완료 조건 함수 · $3 진행 표시 함수
watch_until() {
  local label="$1" done_fn="$2" line_fn="$3"
  local t0 prev=0 prev_at last_change now
  t0="$(now_ms)"; prev_at="$(date +%s)"; last_change="$(date +%s)"
  printf 'elapsed_s,notifications,push_received,rate_now,queue_fanout,queue_push,cpu_app,cpu_pg,cpu_mq,cpu_mock\n' \
    > "$OUT/$label-progress.csv"
  while :; do
    now=$(date +%s); local elapsed=$(( now - (t0 / 1000) ))
    local rows total qf qp st cur delta gap rate
    rows=$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)
    total=$(mock /stats | python3 -c 'import sys,json;print(json.load(sys.stdin).get("total",0))' 2>/dev/null || echo 0)
    qf=$(qdepth notification.fanout); qp=$(qdepth notification.push)
    st="$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null || true)"
    pick() { echo "$st" | awk -v k="$1" '$0 ~ k {gsub("%","",$2); print $2; exit}'; }

    cur=$($done_fn cur "$rows" "$total")
    delta=$(( cur - prev )); gap=$(( now - prev_at )); [ "$gap" -gt 0 ] || gap=1
    rate=$(( delta / gap )); prev=$cur; prev_at=$now

    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$elapsed" "$rows" "$total" "$rate" \
      "${qf:-0}" "${qp:-0}" "$(pick app)" "$(pick postgres)" "$(pick rabbitmq)" "$(pick mock)" \
      >> "$OUT/$label-progress.csv"
    $line_fn "$elapsed" "$rows" "$total" "$rate" "${qf:-0}" "${qp:-0}" "$(pick app)" "$(pick postgres)"

    if $done_fn check "$rows" "$total" "${qf:-0}" "${qp:-0}"; then
      echo; echo "$(( $(now_ms) - t0 ))" > "$OUT/$label-elapsed-ms"; return 0
    fi
    [ "$delta" -eq 0 ] || last_change=$now
    if [ $(( now - last_change )) -ge "$STALL_SECONDS" ]; then
      echo; echo "   ${STALL_SECONDS}초간 진행 없음 — 부분 결과"; echo "$(( $(now_ms) - t0 ))" > "$OUT/$label-elapsed-ms"; return 1
    fi
    sleep 3
  done
}

fanout_state() {
  case "$1" in
    cur)   echo "$2" ;;                                   # 진행 지표 = 알림 행 수
    check) [ "$2" -ge "$TOTAL_USERS" ] && [ "${4:-0}" -eq 0 ] ;;   # 행 다 찼고 팬아웃 큐 비었다
  esac
}
fanout_line() { printf '\r   A %4ss · 알림 %7s · %5s행/s · 큐 f=%-4s p=%-5s · CPU 앱 %s%% pg %s%%   ' \
                  "$1" "$2" "$4" "$5" "$6" "$7" "$8"; }

push_state() {
  case "$1" in
    cur)   echo "$3" ;;                                   # 진행 지표 = 목 수신 건수
    check) [ "$3" -ge "$TOTAL_SUBS" ] ;;
  esac
}
push_line() { printf '\r   B %4ss · 발송 %7s · %5s건/s · 큐 p=%-5s · CPU 앱 %s%% pg %s%%   ' \
                "$1" "$3" "$4" "$6" "$7" "$8"; }

# ── 준비 ─────────────────────────────────────────────────────────────────
echo "▶ 인프라 기동"
PG_CPUSET="0,4,1,5" INFRA_CPUSET="0,4,1,5" APP_CPUSET="2,6,3,7" \
  compose up -d --build --wait --wait-timeout 600 postgres redis rabbitmq mock-push 2>&1 | tail -2

TOTAL_SUBS="$(pg -c 'SELECT count(*) FROM core.push_subscription;' 2>/dev/null || echo 0)"
TOTAL_USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';" 2>/dev/null || echo 0)"
[ "${TOTAL_SUBS:-0}" -gt 0 ] || fail "시드가 없다. bench/run-e2e.sh를 한 번 돌려 볼륨을 채워라."
echo "   수강생 $TOTAL_USERS · 구독 $TOTAL_SUBS"

{ echo "{"; echo "  \"startedAt\": \"$(iso_now)\","
  echo "  \"gitSha\": \"$(git -C "$REPO_ROOT" rev-parse HEAD)\","
  echo "  \"isolated\": $ISOLATED, \"users\": $TOTAL_USERS, \"subscriptions\": $TOTAL_SUBS,"
  echo "  \"appCoresPhysical\": $APP_CORES_PHYSICAL, \"chains\": ${CHAINS:-1},"
  echo "  \"cpuModel\": \"$(awk -F': ' '/model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null || echo unknown)\""
  echo "}"; } > "$OUT/fingerprint.json"

# ── 구간 A ───────────────────────────────────────────────────────────────
if [[ "$PHASE" == *A* ]]; then
  echo "▶ 초기화"
  pg -c "TRUNCATE core.notification, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  mock /reset > /dev/null || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push   > /dev/null 2>&1 || true

  echo "▶ 구간 A — 팬아웃 (푸시 소비 정지 · pg 2물리 · app 2물리)"
  PG_CPUSET="0,4,1,5" INFRA_CPUSET="0,4,1,5" APP_CPUSET="2,6,3,7" \
    FANOUT_ENABLED=true PUSH_ENABLED=false \
    compose up -d --wait --wait-timeout 300 app 2>&1 | tail -1

  # 커서 공간을 CHAINS등분해 독립 체인을 넣는다. user_id가 난수 UUID라 128비트 공간을
  # 균등 분할하면 행 수도 고르게 갈린다. CHAINS=1이면 병렬화 이전과 같다(상한 null).
  CHAINS="${CHAINS:-1}"
  echo "   체인 $CHAINS개"
  material="$(new_uuid)"
  ranges="$(python3 -c "
import sys
n = int(sys.argv[1])
span = 1 << 128
def as_uuid(v):
    h = '%032x' % (v - 1)
    return '%s-%s-%s-%s-%s' % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
for i in range(n):
    lo = '' if i == 0 else as_uuid(i * span // n + 1)
    hi = '' if i == n - 1 else as_uuid((i + 1) * span // n)
    print('%s|%s' % (lo, hi))
" "$CHAINS")"

  chain=0
  while IFS='|' read -r lo hi; do
    chain=$(( chain + 1 ))
    after=$([ -n "$lo" ] && echo "\"$lo\"" || echo null)
    upto=$([ -n "$hi" ] && echo "\"$hi\"" || echo null)
    pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"00000000-0000-4000-8000-000000000002\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$material\",\"subjectName\":\"3주차.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":$after,\"untilUserId\":$upto,\"sliceLimit\":1000}'::jsonb,
                 'PENDING','bench:$material:$chain',0,now(),now(),now());" > /dev/null
  done <<< "$ranges"

  watch_until A fanout_state fanout_line || true
fi

# ── 구간 B ───────────────────────────────────────────────────────────────
if [[ "$PHASE" == *B* ]]; then
  pending="$(qdepth notification.push)"
  [ "${pending:-0}" -gt 0 ] || fail "푸시 큐가 비었다. 구간 A를 먼저 돌려라."
  echo "▶ 구간 B — 발송 (팬아웃 소비 정지 · app 2물리 · 대기 $pending 메시지)"

  PG_CPUSET="0,4" INFRA_CPUSET="1,5" APP_CPUSET="2,6,3,7" \
    FANOUT_ENABLED=false PUSH_ENABLED=true \
    compose up -d --force-recreate --wait --wait-timeout 300 app 2>&1 | tail -1

  watch_until B push_state push_line || true
fi

# ── 결과 ─────────────────────────────────────────────────────────────────
mock /stats > "$OUT/mock-stats.json"
pg -c "SELECT 'notification', count(*) FROM core.notification
       UNION ALL SELECT 'push_progress', count(*) FROM core.notification_push_progress
       UNION ALL SELECT 'outbox_published', count(*) FROM core.outbox_events WHERE status='PUBLISHED';" \
  > "$OUT/db-counts.txt"

python3 - "$OUT" "$TOTAL_SUBS" "$APP_CORES_PHYSICAL" <<'PY'
import json, pathlib, sys
out, subs, cores = pathlib.Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
def ms(name):
    p = out / f"{name}-elapsed-ms"
    return int(p.read_text().strip()) / 1000 if p.exists() else None
a, b = ms("A"), ms("B")
print("\n══ 구간별 결과 ══")
if a: print(f"  A 팬아웃   {a:7.1f}초   알림 행 생성 + 큐 적재   (스케일아웃 불가 — 조각 체인 직렬)")
if b:
    print(f"  B 발송     {b:7.1f}초   {subs:,}건   앱 물리 {cores}코어")
    print(f"             대당 {subs/b:,.0f} 건/s · 코어당 {subs/b/cores:,.0f} 건/s")
if a and b:
    print(f"\n  순차 합계 {a+b:7.1f}초")
    print(f"  실제 운영은 두 구간이 겹치므로 대략 max(A, 발송) 이다")
    need = subs / 60
    per_machine = subs / b
    print(f"\n── 60초 역산 ──")
    print(f"  필요 처리량        {need:,.0f} 건/s")
    print(f"  앱 {cores}코어 1대   {per_machine:,.0f} 건/s")
    print(f"  필요 대수          {need/per_machine:.1f}대  (앱 물리 {cores}코어 기준)")
    print(f"  단, 팬아웃 {a:.0f}초는 대수를 늘려도 줄지 않는다")
    if a >= 60:
        print(f"  → 팬아웃만으로 60초 초과. 커서 공간 분할 없이는 대수를 늘려도 못 맞춘다")
    else:
        print(f"  → 발송에 쓸 수 있는 예산 {60-a:.0f}초 → 필요 대수 {subs/((60-a)*per_machine):.1f}대")
PY
echo; echo "결과: $OUT"
