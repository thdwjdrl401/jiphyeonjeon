#!/usr/bin/env bash
#
# 일괄 팬아웃이 도는 동안 Postgres 백엔드의 메모리 컨텍스트를 뜬다.
#
# **무엇이 그 메모리를 잡았는지 지목하려는 것이다.** cgroup 은 "익명 메모리 1GB" 까지만
# 말하고 그 안에 무엇이 들었는지는 안 말한다. Java 라면 힙 덤프를 떠서 어떤 객체가 몇 개인지
# 보는 자리다. Postgres 에는 pg_log_backend_memory_contexts(pid) 가 있다 — 다른 백엔드에게
# 자기 메모리 컨텍스트를 서버 로그에 쓰게 시킨다. 컨텍스트 이름과 바이트가 나온다.
#
# pg_get_backend_memory_contexts() 는 부른 세션 자신만 본다. 팬아웃은 앱의 커넥션에서
# 도므로 그쪽을 보려면 log 쪽을 써야 한다.
#
# 두 회차를 돈다.
#
#   ① work_mem 기본(64MB)   일괄 조각으로 팬아웃. 도는 중에 컨텍스트를 뜬다
#   ② work_mem 4MB          같은 조각. 설정을 낮춰도 막히는지 본다
#
# ② 를 넣는 이유는 "메모리 설정을 조이면 되지 않나" 라는 반문에 답하기 위해서다.
# work_mem 은 정렬·해시에 걸리는 값이고 집계 누적에는 상한이 아니다. 그것을 측정으로 보인다.
#
# 사용법
#   bash bench/run-memctx-evidence.sh
#   SLICE=1100000 WORKMEM_LOW=4MB bash bench/run-memctx-evidence.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
CF="bench/compose.bench.yml"

SLICE="${SLICE:-1100000}"
WORKMEM_LOW="${WORKMEM_LOW:-4MB}"
TIMEOUT_S="${TIMEOUT_S:-240}"
DUMP_EVERY="${DUMP_EVERY:-2}"      # 몇 초마다 컨텍스트를 뜰 것인가
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"; APP_CPUSET_V="${APP_CPUSET:-2,6}"; INFRA_CPUSET_V="${INFRA_CPUSET:-3,7}"
CUR="00000000-0000-4000-8000-000000000002"
LESSON="00000000-0000-4000-8000-000000000004"
OUT="${OUT:-bench/results/memctx-$(date +%Y%m%dT%H%M%S)}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$CF" "$@"; }
pg()  { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
pgv() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass "$@" < /dev/null; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }

. bench/evidence-lib.sh   # q · show_argv · runc · runq

export PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" APP_CPUSET="$APP_CPUSET_V" \
       APP_HEAP=1g APP_MEM=1600m FANOUT_ENABLED=true PUSH_ENABLED=false \
       CAPTION_ENABLED=false FANOUT_CHAINS=1 FANOUT_CONCURRENCY=8

echo "▶ 인프라 (pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V])"
compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > "$OUT/infra.log" 2>&1 \
  || { tail -20 "$OUT/infra.log" >&2; fail "인프라 기동 실패"; }
compose build app > "$OUT/build.log" 2>&1 \
  || { tail -30 "$OUT/build.log" >&2; fail "앱 빌드 실패"; }
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다"
echo "   수강생 $USERS"

wait_pg_ready() {
  local i
  for i in $(seq 1 180); do pg -c 'SELECT 1;' > /dev/null 2>&1 && return 0; sleep 1; done
  fail "Postgres 가 안 돌아온다"
}

reset_state() {
  pg -c "TRUNCATE core.notification, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null 2>&1 \
    || fail "비우기 실패"
  pg -c "CHECKPOINT;" > /dev/null 2>&1 || true
  for qn in notification.fanout notification.push notification.fanout.dlq notification.push.dlq; do
    compose exec -T rabbitmq rabbitmqctl purge_queue "$qn" < /dev/null > /dev/null 2>&1 || true
  done
}

trigger() {
  local material; material="$(new_uuid)"
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"$CUR\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"$LESSON\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":null,\"untilUserId\":null,\"sliceLimit\":$SLICE}'::jsonb,
                 'PENDING','memctx:$material',0,now(),now(),now());" > /dev/null
}

# 팬아웃을 도는 백엔드를 고른다.
#
# **우리 폴링 질의를 걸러야 한다.** SELECT count(*) FROM core.notification 에도 그 표 이름이
# 들어가서, 표 이름으로 찾으면 우리 자신을 잡는다. 삽입 문장만 고른다 — 팬아웃은 INSERT 로
# 시작하는 CTE 이고 우리 질의는 전부 SELECT 다.
fanout_pid() {
  pg -c "SELECT pid FROM pg_stat_activity
          WHERE datname='liveclass' AND state='active'
            AND pid <> pg_backend_pid()
            AND backend_type = 'client backend'
            AND query ILIKE '%INSERT INTO core.notification%'
          ORDER BY query_start LIMIT 1;" 2>/dev/null
}

run_round() {   # $1 = 라벨, $2 = work_mem (빈 문자열이면 건드리지 않음)
  local label="$1" wm="$2"
  compose rm -sf app > /dev/null 2>&1 || true
  wait_pg_ready
  reset_state
  if [ -n "$wm" ]; then
    pg -c "ALTER DATABASE liveclass SET work_mem = '$wm';" > /dev/null 2>&1 \
      || fail "work_mem 설정 실패"
  else
    pg -c "ALTER DATABASE liveclass RESET work_mem;" > /dev/null 2>&1 || true
  fi
  compose up -d --wait --wait-timeout 420 app > "$OUT/app-$label.log" 2>&1 \
    || { tail -20 "$OUT/app-$label.log" >&2; fail "앱 기동 실패"; }

  local wm_now; wm_now="$(pg -c 'SHOW work_mem;')"
  echo
  echo "══════ $label   조각 $SLICE · work_mem $wm_now ══════"

  trigger "$SLICE"
  local t pid last_pid="" dumped=0
  for ((t = 0; t < TIMEOUT_S; t++)); do
    if (( t % DUMP_EVERY == 0 )); then
      pid="$(fanout_pid)"
      if [ -n "$pid" ]; then
        # 이 함수는 값을 안 돌려준다. 그 백엔드가 자기 컨텍스트를 서버 로그에 쓴다.
        pg -c "SELECT pg_log_backend_memory_contexts($pid);" > /dev/null 2>&1 && dumped=$((dumped+1))
        last_pid="$pid"
      fi
    fi
    local n
    n="$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null)" || break
    [ "${n:-0}" -ge "$USERS" ] && break
    sleep 1
  done
  compose rm -sf app > /dev/null 2>&1 || true
  wait_pg_ready
  [ "$dumped" -gt 0 ] \
    || fail "$label 회차에서 팬아웃 백엔드를 한 번도 못 잡았다. 덤프 없이는 이 회차를 못 쓴다"
  echo "   백엔드 $last_pid · 컨텍스트 $dumped회 기록"
  echo "$last_pid" > "$OUT/pid-$label"
}

# ── ① 기본 설정 ──────────────────────────────────────────────────────────────
run_round "기본" ""
runq "SELECT count(*) AS 만든_알림 FROM core.notification;"

# 서버 로그에서 마지막 덤프만 골라 크기순으로 낸다. 덤프 한 번이 180줄쯤이고 끝에
# Grand total 이 붙는다. tac 으로 뒤집어 첫 Grand total 까지 자르면 마지막 덤프만 남는다.
# 정렬은 힙 덤프 도구가 Retained 로 정렬해 보여 주는 것과 같은 일이다.
LOGCMD="docker compose -f $CF logs --no-log-prefix postgres \\
    | grep -E 'LOG:  (level: |Grand total)' | tac | awk '/Grand total/{g++} g==1' | tac \\
    | sed -E 's/.*LOG:  level: [0-9]+; ([^:]+): ([0-9]+) total.*/\\2 \\1/;
              s/.*LOG:  (Grand total: [0-9]+ bytes).*/999999999 \\1/' \\
    | sort -rn | head -9"
echo
echo "\$ $LOGCMD"
eval "$LOGCMD"

# ── ② work_mem 을 낮춰서 ────────────────────────────────────────────────────
run_round "work_mem 낮춤" "$WORKMEM_LOW"
runq "SELECT count(*) AS 만든_알림 FROM core.notification;"

pg -c "ALTER DATABASE liveclass RESET work_mem;" > /dev/null 2>&1 || true

echo
echo "\$ $LOGCMD"
eval "$LOGCMD"

compose logs --no-log-prefix postgres > "$OUT/postgres.log" 2>&1 || true
echo
echo "결과: $OUT   (postgres.log 에 컨텍스트 덤프 전문)"
