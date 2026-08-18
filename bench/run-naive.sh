#!/usr/bin/env bash
#
# 조각으로 나누지 않으면 무슨 일이 벌어지는지 잰다.
#
# 처음 떠올리는 구조는 이렇다 — "자료를 올렸으니 그 강좌 수강생 전원에게 알림을 만든다."
# 그러면 수강생 100만 명이 한 덩어리가 된다. 그 덩어리가 지나가는 자리마다 한계가 있다.
#
#   Postgres   INSERT 100만 행이 한 문장·한 트랜잭션. array_agg가 uuid 100만 개를 한 값으로 모은다
#   앱         그 100만 개를 ResultSet으로 받아 List<UUID>로 들고, JSON 배열로 직렬화한다(약 38MB)
#   아웃박스    그 38MB가 jsonb 한 행이 된다(TOAST)
#   RabbitMQ   그 38MB가 메시지 하나가 된다
#   푸시 워커   그 38MB를 다시 역직렬화한다
#
# 조각 크기만 바꿔 같은 100만 건을 넣는다. 나머지는 전부 같다 — 갈래 1, 같은 코어 배분, 같은 힙.
# 재는 것은 소요 시간만이 아니다. 힙 최대·GC 정지·아웃박스 행 크기·Postgres 임시 파일까지 본다.
# 시간만 보면 "좀 느리네"로 끝나지만, 터지는 자리는 시간이 아니라 메모리다.
#
# 사용법: bench/run-naive.sh
#         SLICES="1100000 100000 5000" bench/run-naive.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
SLICES="${SLICES:-1100000 200000 50000 5000}"
APP_HEAP="${APP_HEAP:-1g}"
APP_MEM="${APP_MEM:-1600m}"
TIMEOUT_S="${TIMEOUT_S:-300}"
OUT="${OUT:-$BENCH/results/naive-$(date +%Y%m%dT%H%M%S)}"

PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"; APP_CPUSET_V="${APP_CPUSET:-2,6}"; INFRA_CPUSET_V="${INFRA_CPUSET:-3,7}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }

# actuator에서 한 줄짜리 수치를 뽑는다. 앱이 죽어 있으면 빈 문자열이 나온다.
app_metric() { curl -s --max-time 3 http://127.0.0.1:18081/actuator/prometheus 2>/dev/null | awk -v p="$1" '$0 ~ p {s += $NF} END {if (s) printf "%.0f", s}'; }
heap_used() { app_metric '^jvm_memory_used_bytes\{[^}]*area="heap"'; }
gc_pause_sum() { app_metric '^jvm_gc_pause_seconds_sum'; }
app_alive() { [ "$(compose ps -q app | xargs -r docker inspect -f '{{.State.Running}}' 2>/dev/null)" = "true" ]; }

echo "▶ 인프라 기동 (pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V] 인프라[$INFRA_CPUSET_V] · 힙 $APP_HEAP)"
compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
  || fail "인프라 기동 실패"
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS"

reset_state() {
  pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true
  curl -s --max-time 5 http://127.0.0.1:18080/reset > /dev/null 2>&1 || true
}

# 갈래 1·조각 $1로 넓은 팬아웃 한 건을 아웃박스에 넣는다.
trigger() {
  local material; material="$(new_uuid)"
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"00000000-0000-4000-8000-000000000002\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":null,\"untilUserId\":null,\"sliceLimit\":$1}'::jsonb,
                 'PENDING','naive:$material',0,now(),now(),now());" > /dev/null
}

echo "조각,결과,소요초,알림건수,힙최대MB,GC정지초,아웃박스최대행KB,임시파일MB,WAL_MB" > "$OUT/summary.csv"

for SLICE in $SLICES; do
  echo
  echo "══ 조각 $SLICE ══"
  # 푸시 리스너는 끈다. 여기서 보려는 것은 알림을 만드는 쪽이고, 발송이 섞이면 힙이 누구 것인지 흐려진다.
  compose rm -sf app > /dev/null 2>&1 || true
  PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" APP_CPUSET="$APP_CPUSET_V" \
  APP_HEAP="$APP_HEAP" APP_MEM="$APP_MEM" \
  FANOUT_ENABLED=true PUSH_ENABLED=false \
  FANOUT_CONCURRENCY=8 NOTIFICATION_FANOUT_SLICE_SIZE="$SLICE" \
    compose up -d --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"
  reset_state

  T_WAL0="$(pg -c "SELECT pg_current_wal_lsn();")"
  T_TMP0="$(pg -c "SELECT temp_bytes FROM pg_stat_database WHERE datname='liveclass';")"
  HEAP_MAX=0; T0="$(now_ms)"
  trigger "$SLICE"

  # 폴링이 측정에 얹히지 않게 아낀다. 힙은 호스트 포트로 바로 가는 curl이라 가볍고 1초마다,
  # 건수는 docker exec가 필요해 비싸므로 4초마다 본다. 어차피 조각별로 같은 폴링이라 비교는
  # 공정하지만, **여기 절대 시간을 다른 실험의 벽시계와 나란히 놓지는 않는다.**
  RESULT="완료"; N=0
  for ((t = 0; t < TIMEOUT_S; t++)); do
    H="$(heap_used)"
    if [ -n "$H" ]; then
      [ "$H" -gt "$HEAP_MAX" ] && HEAP_MAX="$H"
    elif ! app_alive; then
      RESULT="앱 죽음"; break
    fi
    if (( t % 4 == 3 )); then
      N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null || echo 0)"
      [ "${N:-0}" -ge "$USERS" ] && break
    fi
    sleep 1
  done
  N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null || echo 0)"
  T1="$(now_ms)"
  [ "$RESULT" = "완료" ] && [ "${N:-0}" -lt "$USERS" ] && RESULT="시간초과"

  GC="$(gc_pause_sum || true)"; GC="${GC:-0}"
  OBOX="$(pg -c "SELECT coalesce(max(pg_column_size(payload_json)),0) FROM core.outbox_events WHERE event_type='PUSH_DELIVERY_REQUESTED';" || echo 0)"
  TMP1="$(pg -c "SELECT temp_bytes FROM pg_stat_database WHERE datname='liveclass';" || echo "$T_TMP0")"
  WAL="$(pg -c "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '$T_WAL0');" || echo 0)"

  # 앱이 죽었으면 왜 죽었는지 남긴다. OOM인지 아닌지가 이 실험의 요지다.
  compose logs --tail 400 app > "$OUT/app-slice-$SLICE.log" 2>&1 || true
  OOM="$(grep -c "OutOfMemoryError" "$OUT/app-slice-$SLICE.log" || true)"
  [ "${OOM:-0}" -gt 0 ] && RESULT="힙 부족(OutOfMemoryError)"

  python3 - "$OUT/summary.csv" "$SLICE" "$RESULT" "$T0" "$T1" "${N:-0}" "$HEAP_MAX" "$GC" "$OBOX" "$T_TMP0" "$TMP1" "$WAL" <<'PY'
import sys
f, slice_, res, t0, t1, n, heap, gc, obox, tmp0, tmp1, wal = sys.argv[1:]
row = (f"{slice_},{res},{(int(t1)-int(t0))/1000:.2f},{n},"
       f"{int(heap)/1048576:.0f},{float(gc):.2f},{int(obox)/1024:.0f},"
       f"{(int(tmp1)-int(tmp0))/1048576:.1f},{int(wal)/1048576:.1f}")
open(f, "a").write(row + "\n")
print("   " + row.replace(",", "  "))
PY
done

echo
echo "── 요약 ──"
column -s, -t < "$OUT/summary.csv"
echo "결과: $OUT"
