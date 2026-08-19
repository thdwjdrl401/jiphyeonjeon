#!/usr/bin/env bash
#
# 조각 크기를 바꿔 가며 잰다 — 왕복 횟수와 트랜잭션 크기의 맞바꿈.
#
# 확장 측정이 여기까지 왔다. 벽시계는 **(체인당 조각 수) × (조각당 지연)** 으로 거의
# 정확히 설명된다(실측: 1체인 1000×40.2ms=40.2초, 2체인 500×55.6ms=27.8초,
# 3체인 333×86.7ms=28.9초). 체인을 늘리면 나눠 갖는 조각은 줄지만 조각 하나가 느려져
# 2개에서 이득이 멈춘다. DB 대기의 46.7%가 IO:WALSync였다 — 커밋이 잦다는 뜻이다.
#
# 그래서 남은 지렛대는 체인이 아니라 **조각 크기**다. 100만 명을 1,000명씩 끊으면
# 왕복이 1,000번이고 커밋도 1,000번이다. 조각을 키우면 그 횟수가 그만큼 줄어든다.
#
# 대신 정확히 반대쪽을 지불한다. 슬라이싱을 넣은 이유가 한 트랜잭션에 100만 행을
# 올리지 않기 위해서였다. 조각을 키우면
#   · 트랜잭션 하나가 커져 락 유지 시간이 길어지고
#   · 앱이 한 번에 들고 있는 수신자 명단(UUID 배열)과 푸시 명령 페이로드가 커지고
#   · 실패 시 되돌아가는 양이 커진다
# 그래서 소요 시간만이 아니라 **힙·메시지 크기·조각 지연 분포**를 같이 남긴다.
#
# 체인 수는 2로 고정한다 — 확장 측정에서 가장 빨랐고(27.8초), 여기서 바꾸려는 변수는
# 조각 크기 하나다.
#
# 사용법: bench/run-slice.sh
#         SLICES="1000 2000 5000 10000" bench/run-slice.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
SLICES="${SLICES:-1000 2000 5000}"
CHAINS="${CHAINS:-2}"
OUT="${OUT:-$BENCH/results/slice-$(date +%Y%m%dT%H%M%S)}"
STALL_SECONDS="${STALL_SECONDS:-150}"

PG_CPUSET_V="0,4,1,5"
INFRA_CPUSET_V="3,7"
APP_CPUSET_V="2,6"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }

compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }

# 인스턴스가 같은 코드를 도는지 확인한다. 갈리면 아무 수치도 못 쓴다.
assert_same_image() {
  local ids n
  ids="$(docker inspect --format '{{.Image}}' $(compose ps -q "$@" 2>/dev/null) 2>/dev/null | sort -u)"
  n="$(printf '%s\n' "$ids" | grep -c .)"
  [ "$n" -eq 1 ] || fail "앱 인스턴스가 서로 다른 이미지를 돈다 ($n종)."
}

if [ "${SKIP_ISOLATION:-0}" != "1" ]; then
  others="$(docker ps --format '{{.Names}}' | grep -v '^liveclass-bench' || true)"
  [ -z "$others" ] || fail "벤치 외 컨테이너: $(echo "$others" | paste -sd, -)"
fi

case "$CHAINS" in
  1) profile=""; services=(app) ;;
  2) profile="scale2"; services=(app app2) ;;
  3) profile="scale3"; services=(app app2 app3) ;;
  *) fail "체인 수는 1~3" ;;
esac

echo "▶ 인프라 기동 (pg $PG_CPUSET_V · 브로커 $INFRA_CPUSET_V · 앱 $APP_CPUSET_V · 체인 $CHAINS)"
compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose up -d --build --wait --wait-timeout 600 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
  || fail "인프라 기동 실패"
pg -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" > /dev/null 2>&1 || true
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS"

printf 'slice_limit,elapsed_s,throughput_per_s,slices,slice_ms_mean,wal_mb,app_mem_mb_peak,push_msg_kb\n' > "$OUT/summary.csv"

for SLICE in $SLICES; do
  echo
  echo "════ 조각 ${SLICE}명 · 체인 ${CHAINS}개 ════"
  compose down > /dev/null 2>&1 || true
  PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
    compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1

  pg -c "TRUNCATE core.notification, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true

  args=(up -d --build --wait --wait-timeout 300 "${services[@]}")
  [ -z "$profile" ] || args=(--profile "$profile" "${args[@]}")
  PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  APP_CPUSET="$APP_CPUSET_V" APP2_CPUSET="$APP_CPUSET_V" APP3_CPUSET="$APP_CPUSET_V" \
  APP_HEAP="${APP_HEAP:-1g}" APP_MEM="${APP_MEM:-1600m}" \
  FANOUT_ENABLED=true PUSH_ENABLED=false \
    compose "${args[@]}" > /dev/null 2>&1 || fail "앱 기동 실패"
  assert_same_image "${services[@]}"

  pg -c "SELECT pg_stat_statements_reset();" > /dev/null 2>&1 || true
  wal0="$(pg -c "SELECT pg_current_wal_lsn();")"

  # 메모리를 같이 남긴다. 조각을 키우면 앱이 한 번에 들고 있는 명단이 그만큼 커진다.
  mem_csv="$OUT/mem-$SLICE.csv"
  printf 'ts,container,mem_mb\n' > "$mem_csv"
  ( set +e +o pipefail
    while :; do
      docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null \
        | awk -v t="$(date +%s)" '{split($2,a,"MiB"); v=a[1]+0;
            if ($2 ~ /GiB/) { split($2,b,"GiB"); v=b[1]*1024 }
            print t "," $1 "," v}' >> "$mem_csv"
      sleep 2
    done ) &
  mem_pid=$!
  trap 'kill "$mem_pid" 2>/dev/null || true' EXIT

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
                   'PENDING','slice:$material:$c',0,now(),now(),now());" > /dev/null
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
  kill "$mem_pid" 2>/dev/null || true
  echo

  # 조각 SQL의 호출 수와 평균 지연. 조각을 키우면 호출은 줄고 하나는 길어져야 한다.
  read -r slices slice_ms <<< "$(pg -c "SELECT coalesce(sum(calls),0) || ' ' ||
      coalesce(round((sum(total_exec_time)/nullif(sum(calls),0))::numeric, 2), 0)
      FROM pg_stat_statements WHERE query LIKE 'WITH slice%';")"
  wal_mb="$(pg -c "SELECT round((pg_wal_lsn_diff(pg_current_wal_lsn(), '$wal0') / 1048576.0)::numeric, 1);")"
  push_kb="$(pg -c "SELECT coalesce(round((max(length(payload_json::text)) / 1024.0)::numeric, 1), 0)
                      FROM core.outbox_events WHERE destination = 'notification.push';")"

  python3 - "$OUT/summary.csv" "$SLICE" "$elapsed_ms" "$USERS" "$slices" "$slice_ms" \
            "$wal_mb" "$push_kb" "$OUT/mem-$SLICE.csv" <<'PY'
import csv, os, sys
path, sl, ms, users = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
slices, slice_ms, wal, pushkb, memf = sys.argv[5], sys.argv[6], sys.argv[7], sys.argv[8], sys.argv[9]
sec = ms / 1000
tp = users / sec
peak = 0.0
if os.path.exists(memf):
    vals = [float(r["mem_mb"]) for r in csv.DictReader(open(memf))
            if "-app" in r["container"] and r.get("mem_mb")]
    peak = max(vals) if vals else 0.0
with open(path, "a") as f:
    f.write("%d,%.1f,%.0f,%s,%s,%s,%.0f,%s\n" % (sl, sec, tp, slices, slice_ms, wal, peak, pushkb))
print("   조각 %5d명 → %.1f초 · %d건/s · 조각 %s회 · 조각당 %sms · WAL %sMB · 앱힙 %.0fMB · 푸시메시지 %sKB"
      % (sl, sec, tp, slices, slice_ms, wal, peak, pushkb))
PY
done

echo
echo "════ 조각 크기 ════"
column -s, -t "$OUT/summary.csv"
echo
echo "결과: $OUT"
