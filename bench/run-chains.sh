#!/usr/bin/env bash
#
# 체인을 늘렸을 때 느려지는 것이 DB 때문인지 앱 때문인지 가른다.
#
# 앞선 체인 스윕(1→40.2초, 2→27.8초, 3→28.9초)에서 "조각당 지연"을 벽시계÷조각수로 계산했다.
# 그 값에는 DB 시간과 DB 밖 시간이 섞여 있고, 게다가 그 실험은 앱 인스턴스를 늘리면서 **앱
# 코어를 고정**했다 — 물리 1코어를 둘이, 셋이 나눠 썼다. 그러면 DB 밖 시간이 시분할 때문에
# 늘어나는데, 그것을 DB 경합으로 잘못 읽을 수 있다.
#
# 여기서는 둘을 가른다.
#
#   조각당 DB 시간   pg_stat_statements의 조각 SQL 평균 (정확히 DB 안에서 쓴 시간)
#   조각당 DB 밖     (벽시계 × 체인수 − DB 총합) ÷ 조각수
#                    수신자 UUID를 JSON으로 만들고, 브로커에 넣고, 다음 조각을 기다린 시간
#
#   DB 시간이 그대로면  → 원인은 앱 시분할. 코어를 주면 병렬이 통한다
#   DB 시간이 늘면      → 원인은 DB 경합. 병렬이 진짜로 손해다
#
# **프로세스가 아니라 한 프로세스 안의 소비자 스레드로 늘린다.** JVM을 여러 개 띄우면 힙과 GC가
# 각각 붙어 그 자체가 변수가 되고, 운영도 RABBIT_LISTENER_CONCURRENCY로 스레드를 늘리는 구조다.
#
# 배분은 고정한다 — pg 2코어 전용 · 브로커 1코어 전용 · 앱 1코어 전용. 바꾸는 변수는 체인 수 하나.
#
# 사용법: bench/run-chains.sh
#         CHAIN_COUNTS="1 2 4 8" SLICE=5000 bench/run-chains.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
CHAIN_COUNTS="${CHAIN_COUNTS:-1 2 3 4 6 8}"
# 소비자 스레드 수. 비워 두면 **체인 수 x 2**다 — 운영 기준과 같다(ADR-0134).
# ADR-0131은 "체인보다 많아야 효과가 난다"고 적었으나 통제 재측정에서 재현되지 않았다.
# 체인 2에서 소비자 2/3/4/8의 체인당 진행 간격이 138/140/135/136ms로 같다.
# 그때 근거였던 20.5초 대 18.3초는 이 스크립트의 손잡이가 고장 난 상태에서 나온 값이다.
CONCURRENCY="${CONCURRENCY:-}"
SLICE="${SLICE:-5000}"
OUT="${OUT:-$BENCH/results/chains-$(date +%Y%m%dT%H%M%S)}"
STALL_SECONDS="${STALL_SECONDS:-150}"

# 배분은 밖에서 바꾼다. 팬아웃에서 앱은 물리 코어의 1/4밖에 안 쓰므로(실측 최대 51%/200%)
# 앱에 1코어를 통째로 주는 것은 낭비다 — 남는 몫을 DB로 옮겨 보는 것이 이 손잡이의 용도다.
#
#   기본     pg 2코어 · 브로커 1코어 · 앱 1코어
#   DB 우선  PG_CPUSET=0,4,1,5,2,6 INFRA_CPUSET=3,7 APP_CPUSET=3,7   (앱+브로커가 1코어 공유)
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"
INFRA_CPUSET_V="${INFRA_CPUSET:-3,7}"
APP_CPUSET_V="${APP_CPUSET:-2,6}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }

compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }

if [ "${SKIP_ISOLATION:-0}" != "1" ]; then
  others="$(docker ps --format '{{.Names}}' | grep -v '^liveclass-bench' || true)"
  [ -z "$others" ] || fail "벤치 외 컨테이너: $(echo "$others" | paste -sd, -)"
fi

echo "▶ 인프라 기동 (pg $PG_CPUSET_V · 브로커 $INFRA_CPUSET_V · 앱 $APP_CPUSET_V · 조각 $SLICE)"
compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose up -d --build --wait --wait-timeout 600 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
  || fail "인프라 기동 실패"
pg -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" > /dev/null 2>&1 || true
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS"

printf 'chains,span_s,elapsed_s,throughput_per_s,slices,db_ms_per_slice,offdb_ms_per_slice,db_total_s,concurrency,app_cpu_pct,pg_cpu_pct\n' > "$OUT/summary.csv"

for CHAINS in $CHAIN_COUNTS; do
  echo
  echo "════ 체인 ${CHAINS}개 · 소비자 ${CONCURRENCY:-$(( CHAINS * 2 ))}개 (앱 프로세스 1개) ════"
  compose rm -sf app app2 app3 > /dev/null 2>&1 || true

  pg -c "TRUNCATE core.notification, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true

  # 소비자 수 = 체인 수 x 2 (ADR-0134). 체인 하나가 동시에 쓸 수 있는 스레드가 최대 둘이다.
  PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" APP_CPUSET="$APP_CPUSET_V" \
  APP_HEAP="${APP_HEAP:-1g}" APP_MEM="${APP_MEM:-1600m}" \
  FANOUT_ENABLED=true PUSH_ENABLED=false \
  FANOUT_CONCURRENCY="${CONCURRENCY:-$(( CHAINS * 2 ))}" \
    compose up -d --build --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"

  pg -c "SELECT pg_stat_statements_reset();" > /dev/null 2>&1 || true

  cpu_csv="$OUT/cpu-$CHAINS.csv"
  printf 'ts,container,cpu_pct\n' > "$cpu_csv"
  ( set +e +o pipefail
    while :; do
      docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null \
        | awk -v t="$(date +%s)" '{gsub(/%/,"",$2); print t "," $1 "," $2}' >> "$cpu_csv"
      sleep 2
    done ) &
  cpu_pid=$!
  trap 'kill "$cpu_pid" 2>/dev/null || true' EXIT

  # 128비트 공간을 체인 수만큼 등분한다. 사용자 id가 v4 랜덤이라 구간마다 인원이 고르다.
  material="$(new_uuid)"
  ranges="$(python3 -c "
import sys
n = int(sys.argv[1]); span = 1 << 128
def u(v):
    h = '%032x' % (v - 1)
    return '%s-%s-%s-%s-%s' % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
for i in range(n):
    print('%s|%s' % ('' if i == 0 else u(i * span // n + 1),
                     '' if i == n - 1 else u((i + 1) * span // n)))
" "$CHAINS")"
  c=0
  while IFS='|' read -r lo hi; do
    c=$(( c + 1 ))
    after=$([ -n "$lo" ] && echo "\"$lo\"" || echo null)
    upto=$([ -n "$hi" ] && echo "\"$hi\"" || echo null)
    pg -c "INSERT INTO core.outbox_events
            (aggregate_type, aggregate_id, event_type, destination, payload_json,
             status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
           VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                   '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"00000000-0000-4000-8000-000000000002\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":$after,\"untilUserId\":$upto,\"sliceLimit\":$SLICE}'::jsonb,
                   'PENDING','chain:$material:$c',0,now(),now(),now());" > /dev/null
  done <<< "$ranges"

  t0="$(now_ms)"; prev=0; last_change=$(date +%s)
  while :; do
    now=$(date +%s)
    cur="$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)"
    printf '\r   %4ss · %8s/%s   ' "$(( now - (t0 / 1000) ))" "$cur" "$USERS"
    [ "$cur" -eq "$prev" ] || last_change=$now
    prev=$cur
    [ "$cur" -ge "$USERS" ] && break
    [ $(( now - last_change )) -ge "$STALL_SECONDS" ] && { echo; echo "   정체 — 부분 결과"; break; }
    sleep 2
  done
  elapsed_ms=$(( $(now_ms) - t0 ))
  kill "$cpu_pid" 2>/dev/null || true
  echo

  # 하네스 시계는 앞뒤가 오염돼 있다. 앞에는 릴레이 폴링 대기가 붙는다 — 이 스크립트가 아웃박스
  # 행을 psql로 직접 넣어 afterCommit 깨우기 경로(ADR-0122)를 안 타므로, 릴레이가 폴링으로 집을
  # 때까지 0~RELAY_DELAY_MS를 기다린다. 뒤에는 완료 확인 주기 0~2초가 붙는다.
  # 둘을 합쳐 회차마다 평균 3.5초가 얹혔고, 그게 조건 간 차이를 덮었다(ADR-0134).
  #
  # 그래서 지표는 DB가 스스로 남긴 시각에서 뽑는다. core.notification.created_at의 기본값이
  # clock_timestamp()라 행마다 찍히므로, 최소~최대가 곧 첫 행부터 마지막 행까지의 팬아웃 구간이다.
  # 하네스가 언제 넣었는지, 언제 알아챘는지와 무관하다.
  span_s="$(pg -c "SELECT round(extract(epoch FROM max(created_at) - min(created_at))::numeric, 2)
                   FROM core.notification;")"

  read -r slices db_ms <<< "$(pg -c "SELECT coalesce(sum(calls),0) || ' ' ||
      coalesce(round((sum(total_exec_time)/nullif(sum(calls),0))::numeric, 2), 0)
      FROM pg_stat_statements WHERE query LIKE 'WITH slice%';")"

  python3 - "$OUT/summary.csv" "$CHAINS" "$elapsed_ms" "$USERS" "$slices" "$db_ms" "$cpu_csv" "$span_s" <<'PY'
import csv, os, sys
path, chains, ms, users = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
slices, db_ms, cpuf = int(sys.argv[5] or 0), float(sys.argv[6] or 0), sys.argv[7]
span = float(sys.argv[8] or 0)            # DB가 남긴 첫 행~마지막 행 구간(초)
harness = ms / 1000                       # 하네스 시계. 폴링 대기가 섞여 있어 참고용이다
sec = span if span > 0 else harness       # 파생 지표는 전부 이 값에서 나온다
tp = users / sec if sec else 0
db_total = slices * db_ms / 1000          # DB 안에서 쓴 시간의 총합(초)
# 체인이 c개면 c개가 동시에 도므로, 한 체인이 구간 동안 낼 수 있는 시간은 sec다.
# DB 밖 시간 = (체인 하나의 구간) − (체인 하나가 DB에서 쓴 시간)
per_chain_db = db_total / chains if chains else 0
per_chain_slices = slices / chains if chains else 0
offdb_ms = ((sec - per_chain_db) / per_chain_slices * 1000) if per_chain_slices else 0
concurrency = db_total / sec if sec else 0

app = pgc = 0.0
if os.path.exists(cpuf):
    agg = {}
    for r in csv.DictReader(open(cpuf)):
        if r.get("cpu_pct"):
            agg.setdefault(r["container"], []).append(float(r["cpu_pct"]))
    def avg(pred):
        return sum(sum(v)/len(v) for k, v in agg.items() if pred(k))
    app = avg(lambda k: "-app" in k)
    pgc = avg(lambda k: "postgres" in k)

with open(path, "a") as f:
    f.write("%d,%.2f,%.1f,%.0f,%d,%.2f,%.1f,%.1f,%.2f,%.0f,%.0f\n"
            % (chains, span, harness, tp, slices, db_ms, offdb_ms, db_total, concurrency, app, pgc))
print("   체인 %d → %.2f초(DB 구간) · %d건/s · 조각 %d회 · DB %.2fms/조각 · DB밖 %.1fms/조각 "
      "· DB총합 %.1f초 · 동시성 %.2f · 앱CPU %.0f%% · pgCPU %.0f%%"
      % (chains, span, tp, slices, db_ms, offdb_ms, db_total, concurrency, app, pgc))
print("      하네스 시계 %.1f초 — 차이 %.1f초가 릴레이 폴링 대기와 완료 확인 주기다"
      % (harness, harness - span))
PY
done

echo
echo "════ 체인 수 ════"
column -s, -t "$OUT/summary.csv"
echo
echo "읽는 법: db_ms_per_slice가 체인을 늘려도 그대로면 병목은 앱 쪽(시분할),"
echo "         늘어나면 DB 경합이다. offdb_ms_per_slice가 늘면 앱이 코어를 나눠 쓰는 중이다."
echo
echo "결과: $OUT"
