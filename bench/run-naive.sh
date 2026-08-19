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
SLICES="${SLICES:-1100000 800000 500000 300000 200000 5000}"
APP_HEAP="${APP_HEAP:-1g}"
APP_MEM="${APP_MEM:-1600m}"
TIMEOUT_S="${TIMEOUT_S:-180}"
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
app_metric() { curl -s --max-time 3 http://127.0.0.1:18081/actuator/prometheus 2>/dev/null | awk -v p="$1" '$0 ~ p {s += $NF} END {if (s) printf "%.6f", s}'; }
heap_used() { app_metric '^jvm_memory_used_bytes[{][^}]*area="heap"' | cut -d. -f1; }
gc_pause_sum() { app_metric '^jvm_gc_pause_seconds_sum'; }

# 컨테이너 메모리는 호스트 cgroup 파일에서 바로 읽는다. docker stats나 exec는 폴링에 얹히지만
# 이건 그냥 파일 하나다. memory.peak은 cgroup이 생긴 뒤의 최고치라 변형마다 0으로 되돌린다.
# memory.peak은 되돌리려면 권한이 필요하고 컨테이너가 살아 있는 동안 누적된다. 그래서 대신
# memory.current를 1초마다 읽어 변형 안에서의 최고치를 잡는다 — 파일 하나 읽기라 부담이 없다.
cgroup_of() {
  local id p; id="$(compose ps -q "$1")"; [ -n "$id" ] || return 1
  for p in "/sys/fs/cgroup/system.slice/docker-$id.scope" \
           "/sys/fs/cgroup/docker/$id" \
           "/sys/fs/cgroup/memory/docker/$id"; do
    [ -r "$p/memory.current" ] && { echo "$p"; return 0; }
  done
  return 1
}
pg_mem_now() { cat "$PG_CGROUP/memory.current" 2>/dev/null || echo 0; }
pg_oomkilled() { docker inspect "$(compose ps -q postgres)" --format '{{.State.OOMKilled}}' 2>/dev/null; }
app_alive() { [ "$(compose ps -q app | xargs -r docker inspect -f '{{.State.Running}}' 2>/dev/null)" = "true" ]; }

echo "▶ 인프라 기동 (pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V] 인프라[$INFRA_CPUSET_V] · 힙 $APP_HEAP)"
# 관측을 켜고 돌릴 때는 내리지 않는다. down이 네트워크를 지우면 붙어 있던 cAdvisor·exporter가
# 떨어져 스크레이프가 끊기고, 정작 보려던 메모리 곡선에 구멍이 난다.
[ "${KEEP_UP:-0}" = "1" ] || compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
  || fail "인프라 기동 실패"
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS"
PG_CGROUP="$(cgroup_of postgres || true)"
[ -n "${PG_CGROUP:-}" ] && echo "   postgres cgroup $PG_CGROUP" \
  || echo "   postgres cgroup 찾지 못함 — 메모리 열은 0으로 남는다"

reset_state() {
  pg -c "TRUNCATE core.notification, core.notification_content,
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

echo "조각,결과,소요초,알림건수,앱힙최대MB,GC정지초,pg메모리최대MB,pgOOM,아웃박스최대행KB,WAL_MB" > "$OUT/summary.csv"

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
  # 1초 표본을 파일로 남긴다. cAdvisor는 working set(회수 가능한 파일 캐시를 뺀 값)을 보는데
  # 여기 증가분은 대부분 그 캐시라, 한계에 닿는 장면이 그쪽 그래프에는 안 나온다.
  # OOM 판정이 걸리는 값은 memory.current이고 그것을 직접 읽는다.
  SERIES="$OUT/mem-$SLICE.csv"; echo "t_ms,pg_bytes,limit_bytes" > "$SERIES"
  PG_LIMIT="$(cat "$PG_CGROUP/memory.max" 2>/dev/null || echo 0)"
  HEAP_MAX=0; PG_MAX=0; T0="$(now_ms)"
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
    M="$(pg_mem_now)"; [ "${M:-0}" -gt "$PG_MAX" ] && PG_MAX="$M"
    echo "$(now_ms),${M:-0},${PG_LIMIT:-0}" >> "$SERIES"
    if (( t % 4 == 3 )); then
      # 세는 데 실패하면 Postgres가 답을 못 하는 것이다. 넘어갔으면 더 기다릴 이유가 없다.
      if ! N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null)"; then
        [ "$(pg_oomkilled)" = "true" ] && break
        N=0
      fi
      [ "${N:-0}" -ge "$USERS" ] && break
    fi
    sleep 1
  done
  N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null || echo 0)"
  T1="$(now_ms)"
  [ "$RESULT" = "완료" ] && [ "${N:-0}" -lt "$USERS" ] && RESULT="시간초과"

  GC="$(gc_pause_sum || true)"; GC="${GC:-0}"
  M="$(pg_mem_now)"; [ "${M:-0}" -gt "$PG_MAX" ] && PG_MAX="$M"
  PGOOM="$(pg_oomkilled)"
  # Postgres가 넘어갔으면 앱이 아니라 여기가 먼저 터진 것이다. 크래시 복구가 전량 롤백하므로
  # 알림 건수는 0이 되고, 그때까지 쓴 WAL은 아무것도 남기지 못한 채 버려진다.
  if [ "$PGOOM" = "true" ]; then
    RESULT="Postgres 메모리 초과(OOMKilled) → 크래시 복구·전량 롤백"
    compose logs --tail 200 postgres > "$OUT/pg-slice-$SLICE.log" 2>&1 || true
    compose restart postgres > /dev/null 2>&1 || true
    compose up -d --wait --wait-timeout 300 postgres > /dev/null 2>&1 || true
    PG_CGROUP="$(cgroup_of postgres || true)"   # 재시작하면 cgroup 경로가 바뀐다
  fi
  OBOX="$(pg -c "SELECT coalesce(max(pg_column_size(payload_json)),0) FROM core.outbox_events WHERE event_type='PUSH_DELIVERY_REQUESTED';" || echo 0)"
  WAL="$(pg -c "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '$T_WAL0');" 2>/dev/null || echo 0)"

  # 앱이 죽었으면 왜 죽었는지 남긴다. OOM인지 아닌지가 이 실험의 요지다.
  compose logs --tail 400 app > "$OUT/app-slice-$SLICE.log" 2>&1 || true
  OOM="$(grep -c "OutOfMemoryError" "$OUT/app-slice-$SLICE.log" || true)"
  [ "${OOM:-0}" -gt 0 ] && RESULT="힙 부족(OutOfMemoryError)"

  python3 - "$OUT/summary.csv" "$SLICE" "$RESULT" "$T0" "$T1" "${N:-0}" "$HEAP_MAX" "$GC" "$PG_MAX" "${PGOOM:-false}" "$OBOX" "$WAL" <<'PY'
import sys
f, slice_, res, t0, t1, n, heap, gc, pgmem, pgoom, obox, wal = sys.argv[1:]
row = (f"{slice_},{res},{(int(t1)-int(t0))/1000:.2f},{n},"
       f"{int(heap)/1048576:.0f},{float(gc):.2f},{int(pgmem)/1048576:.0f},{pgoom},"
       f"{int(obox)/1024:.0f},{int(wal)/1048576:.1f}")
open(f, "a").write(row + "\n")
print("   " + row.replace(",", "  "))
PY
done

echo
echo "── 요약 ──"
column -s, -t < "$OUT/summary.csv"
echo "결과: $OUT"
