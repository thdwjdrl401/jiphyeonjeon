#!/usr/bin/env bash
#
# 항목 2(일괄 조회·단일 INSERT의 Postgres OOM → 커서 범위 슬라이싱)의 증거를 만든다.
#
# 조각 크기만 바꿔 같은 100만 건을 넣는다. 나머지는 전부 같다 — 갈래 1, 같은 코어 배분,
# 같은 힙, 푸시는 꺼 둔다. 조각 1,100,000 이면 한 조각이 수강생 전원이라 그것이 일괄 구조다.
# 되돌린 브랜치가 필요 없다. 조각 크기가 런타임 값이기 때문이다.
#
# 화면에 나가는 것은 두 덩이다. 각각 포트폴리오의 한 자리에 대응한다.
#
#   ① 일괄 한 번의 결말      메모리 한도 → OOMKilled=true → 크래시 복구 로그 → 알림 0건 → 버려진 WAL
#                            (문제 절: "1.5GB 를 초과해 강제 종료 … 전량 롤백되어 알림 0건")
#   ② 조각만 바꾼 비교표     pgOOM 열이 일괄에서만 true · 알림 0 vs 100만 · 앱 힙이 조각과 무관
#                            · 소요 시간이 조각과 무관
#                            (원인 파악: "병목이 앱이 아니라 PostgreSQL" / 결과: "분할은 완료를 위한 조치")
#
# 그래프용 표본은 파일로 남긴다(화면에 찍지 않는다).
#
#   mem-<조각>.csv   1초마다 t_ms, anon, file, shmem, current, limit, heap
#
# **메모리는 anon 을 본다.** memory.current 는 페이지 캐시를 포함해 신호가 뒤집힌다 — 지난 측정에서
# 50만 조각이 1,497MB 로 한도(1,536MB)에 붙었는데 죽지 않았고, 80만 조각은 1,112MB 로 더 낮았다.
# 조각이 클수록 커져야 하는 값이 거꾸로 나온 것이다. cgroup v2 의 memory.stat 은 익명 메모리(anon)와
# 페이지 캐시(file)를 나눠 주므로, 작업 자체가 쓴 메모리는 anon 으로 본다.
#
# 사용법: bash bench/run-oom-evidence.sh
#         SLICES="1100000 5000" bash bench/run-oom-evidence.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 화면에 상대 경로를 찍으므로 루트에서 돈다. 안 그러면 찍는 경로와 넘기는 경로가 어긋난다.
cd "$REPO_ROOT" || exit 1
CF="bench/compose.bench.yml"
BENCH="$REPO_ROOT/bench"

SLICES="${SLICES:-1100000 800000 5000}"
BATCH_SLICE="${BATCH_SLICE:-1100000}"      # 이 조각이 일괄 구조다(한 조각 = 전원)
APP_HEAP="${APP_HEAP:-1g}"; APP_MEM="${APP_MEM:-1600m}"
TIMEOUT_S="${TIMEOUT_S:-240}"
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"; APP_CPUSET_V="${APP_CPUSET:-2,6}"; INFRA_CPUSET_V="${INFRA_CPUSET:-3,7}"
CUR="00000000-0000-4000-8000-000000000002"
LESSON="00000000-0000-4000-8000-000000000004"
OUT="${OUT:-bench/results/oom-$(date +%Y%m%dT%H%M%S)}"   # 화면에 찍히므로 상대 경로

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$CF" "$@"; }
pg()  { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
pgv() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass "$@" < /dev/null; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

. bench/evidence-lib.sh   # q · show_argv · runc · runq

# 컨테이너 이름을 풀어 쓴다. $(docker compose ... ps -q postgres) 를 그대로 찍으면 한 줄이
# 150자가 되어 화면에서 접히고, 정작 봐야 할 OOMKilled 가 벽 속에 묻힌다.
show_inspect() {  # $1 = --format 값
  echo
  show_argv "docker inspect" "$PGC" --format "$1"
  docker inspect "$PGC" --format "$1"
}

app_metric() { curl -s --max-time 3 http://127.0.0.1:18081/actuator/prometheus 2>/dev/null \
                 | awk -v p="$1" '$0 ~ p {s += $NF} END {if (s) printf "%.0f", s}'; }
heap_used() { app_metric '^jvm_memory_used_bytes[{][^}]*area="heap"'; }
app_alive() { [ "$(compose ps -q app | xargs -r docker inspect -f '{{.State.Running}}' 2>/dev/null)" = "true" ]; }
pg_oomkilled() { docker inspect "$(compose ps -q postgres)" --format '{{.State.OOMKilled}}' 2>/dev/null; }
# **회차를 가르는 것은 이 카운터다.** docker inspect 의 OOMKilled 는 컨테이너를 다시 만들기 전까지
# 켜진 채로 남는다. 첫 회차가 죽고 나면 뒤의 회차도 전부 true 로 찍혀 비교표가 무의미해진다.
# cgroup v2 의 memory.events 는 oom_kill 을 누적해서 세므로 회차 앞뒤 차이로 판정한다.
oom_kills() { awk '$1=="oom_kill"{print $2}' "$PG_CGROUP/memory.events" 2>/dev/null; }

# 컨테이너 메모리는 호스트 cgroup 파일에서 바로 읽는다. exec 는 폴링에 얹히지만 이건 파일 하나다.
cgroup_of() {
  local id p; id="$(compose ps -q "$1")"; [ -n "$id" ] || return 1
  for p in "/sys/fs/cgroup/system.slice/docker-$id.scope" \
           "/sys/fs/cgroup/docker/$id" "/sys/fs/cgroup/memory/docker/$id"; do
    [ -r "$p/memory.current" ] && { echo "$p"; return 0; }
  done
  return 1
}
# anon,file,shmem 을 한 번에 읽는다. 없는 항목은 0.
mem_stat() {
  awk '$1=="anon"{a=$2} $1=="file"{f=$2} $1=="shmem"{s=$2}
       END{printf "%d,%d,%d", a+0, f+0, s+0}' "$PG_CGROUP/memory.stat" 2>/dev/null || echo "0,0,0"
}

# **cpuset 을 인프라보다 먼저 내보내야 한다.** 아래에 두었더니 postgres·rabbitmq 가 코어 배분
# 없이 떠서 측정 조건이 달라졌다. 조각 크기가 메시지로 옮겨 가면서 회차마다의 앱 설정도
# 같아졌으므로 env 는 여기서 한 번만 내보낸다.
# 조각 크기가 메시지로 옮겨 가면서 회차마다의 앱 설정이 같아졌다. 그래서 env 는 한 번만
# 내보내고, 회차마다의 앱 내림·올림은 화면에 보인다(runc). 숨기면 화면이 텍스트 덩어리가 된다.
export PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" APP_CPUSET="$APP_CPUSET_V" \
       APP_HEAP="$APP_HEAP" APP_MEM="$APP_MEM" \
       FANOUT_ENABLED=true PUSH_ENABLED=false CAPTION_ENABLED=false \
       FANOUT_CHAINS=1 FANOUT_CONCURRENCY=8

echo "▶ 인프라 기동 (pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V] 인프라[$INFRA_CPUSET_V] · 힙 $APP_HEAP)"
# **postgres 컨테이너를 다시 만들고 시작한다.** docker inspect 의 OOMKilled 는 컨테이너를 다시
# 만들기 전까지 켜진 채로 남는다. 앞선 실행이 죽여 놨으면 ① 캡처의 OOMKilled=true 가 이번 것인지
# 지난 것인지 구분되지 않는다. 데이터는 볼륨에 있어 사라지지 않는다.
compose rm -sf postgres app > /dev/null 2>&1 || true
compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > "$OUT/infra.log" 2>&1 \
  || { tail -20 "$OUT/infra.log" >&2; fail "인프라 기동 실패"; }
PGC="$(docker inspect "$(compose ps -q postgres)" --format '{{.Name}}' 2>/dev/null | sed 's#^/##')"
[ -n "$PGC" ] || fail "postgres 컨테이너 이름을 못 찾았다. 인프라가 안 떴다"
[ "$(pg_oomkilled)" = "false" ] \
  || fail "시작부터 OOMKilled=$(pg_oomkilled) 다. 플래그가 깨끗하지 않으면 ① 캡처를 못 쓴다"
# 이미지는 한 번만 굽는다. 조각 크기가 메시지로 가면서 회차마다 다시 빌드할 이유가 없어졌다.
# 빌드 로그는 준비 단계라 파일로 보내되, 실패하면 그 자리에서 띄우고 멈춘다.
compose build app > "$OUT/build.log" 2>&1 \
  || { tail -30 "$OUT/build.log" >&2; fail "앱 이미지 빌드 실패. 위 로그를 보라"; }
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다. 수강생 0명이면 잴 것이 없다"
PG_CGROUP="$(cgroup_of postgres || true)"
[ -n "${PG_CGROUP:-}" ] || fail "postgres cgroup 경로를 못 찾았다. 메모리 표본 없이는 이 회차를 못 쓴다"
[ -n "$(oom_kills)" ] || fail "memory.events 에 oom_kill 이 없다. 회차별 OOM 판정을 못 하므로 못 쓴다"
echo "   수강생 $USERS · cgroup $PG_CGROUP · 지금까지 oom_kill $(oom_kills)회"

wait_pg_ready() {  # 크래시 복구가 끝나 접속을 받을 때까지
  local i
  for i in $(seq 1 180); do
    pg -c 'SELECT 1;' > /dev/null 2>&1 && return 0
    sleep 1
  done
  fail "Postgres 가 180초 안에 접속을 받지 않는다. 이 회차는 못 쓴다"
}

reset_state() {
  pg -c "TRUNCATE core.notification, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  for qn in notification.fanout notification.push notification.fanout.dlq notification.push.dlq; do
    compose exec -T rabbitmq rabbitmqctl purge_queue "$qn" < /dev/null > "$OUT/purge.log" 2>&1 \
      || grep -q 'no queue\|not_found' "$OUT/purge.log" \
      || { sed 's/^/  /' "$OUT/purge.log" >&2; fail "$qn 비우기 실패"; }
  done
  # 소비자가 붙어 있으면 미확인 메시지가 비운 뒤에 되돌아온다. 한 번 더 보고 그래도 남으면 멈춘다.
  local left i
  for i in 1 2 3; do
    left="$(compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null \
            | awk '$1 ~ /^notification\./ && $2 > 0 {printf "%s=%s ", $1, $2}')"
    [ -z "$left" ] && return 0
    sleep 2
    for qn in notification.fanout notification.push notification.fanout.dlq notification.push.dlq; do
      compose exec -T rabbitmq rabbitmqctl purge_queue "$qn" < /dev/null > /dev/null 2>&1 || true
    done
  done
  fail "비웠는데 남아 있다: $left (소비자가 살아 있지 않은지 보라)"
}



trigger() {  # 갈래 1 · 조각 $1 로 넓은 팬아웃 한 건을 아웃박스에 넣는다
  local material; material="$(new_uuid)"
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"$CUR\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"$LESSON\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":null,\"untilUserId\":null,\"sliceLimit\":$1}'::jsonb,
                 'PENDING','oom:$material',0,now(),now(),now());" > /dev/null
}

echo "조각,소요초,알림건수,앱힙최대MB,pg_anon최대MB,pg_current최대MB,한도MB,pgOOM,아웃박스최대행KB,WAL_MB,결과" > "$OUT/summary.csv"
PG_LIMIT="$(cat "$PG_CGROUP/memory.max" 2>/dev/null || echo 0)"
# 한도가 없으면 memory.max 는 "max" 라는 글자다. 그대로 두면 산술에서 깨진다.
case "$PG_LIMIT" in ''|*[!0-9]*) PG_LIMIT=0 ;; esac

for SLICE in $SLICES; do
  # **비우기 전에 소비자를 내린다.** 워커가 메시지를 미확인으로 쥐고 있으면 purge 뒤에 되돌아온다.
  # 앞 회차가 OOM 이었으면 Postgres 가 아직 복구 중이라 TRUNCATE 도 못 한다. 그것부터 기다린다.
  echo; echo "── 조각 $SLICE ──"
  compose rm -sf app > /dev/null 2>&1 || true
  wait_pg_ready
  reset_state
  compose up -d --wait --wait-timeout 420 app > "$OUT/app-start.log" 2>&1 \
    || { tail -20 "$OUT/app-start.log" >&2; fail "앱 기동 실패. 위 로그를 보라"; }
  T_WAL0="$(pg -c "SELECT pg_current_wal_lsn();")"
  SERIES="$OUT/mem-$SLICE.csv"
  echo "t_ms,anon,file,shmem,current,limit,heap" > "$SERIES"
  HEAP_MAX=0; ANON_MAX=0; CUR_MAX=0; T0="$(now_ms)"; RESULT="완료"; N=0
  OOMK0="$(oom_kills)"; OOMK0="${OOMK0:-0}"
  trigger "$SLICE"

  for ((t = 0; t < TIMEOUT_S; t++)); do
    H="$(heap_used)"
    if [ -n "$H" ]; then [ "$H" -gt "$HEAP_MAX" ] && HEAP_MAX="$H"
    elif ! app_alive; then RESULT="앱 죽음"; break; fi
    ST="$(mem_stat)"; A="${ST%%,*}"; C="$(cat "$PG_CGROUP/memory.current" 2>/dev/null || echo 0)"
    [ "${A:-0}" -gt "$ANON_MAX" ] && ANON_MAX="$A"
    [ "${C:-0}" -gt "$CUR_MAX" ] && CUR_MAX="$C"
    echo "$(now_ms),$ST,${C:-0},${PG_LIMIT:-0},${H:-0}" >> "$SERIES"
    if (( t % 4 == 3 )); then
      if ! N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null)"; then
        OOMK="$(oom_kills)"; [ "${OOMK:-0}" -gt "$OOMK0" ] && break
        N=0
      fi
      [ "${N:-0}" -ge "$USERS" ] && break
    fi
    sleep 1
  done
  T1="$(now_ms)"
  OOMK1="$(oom_kills)"; OOMK1="${OOMK1:-0}"
  if [ "$OOMK1" -gt "$OOMK0" ]; then PGOOM=true; else PGOOM=false; fi

  if [ "$PGOOM" = "true" ]; then
    RESULT="Postgres OOMKilled → 크래시 복구 · 전량 롤백"
    compose logs --tail 200 postgres > "$OUT/pg-slice-$SLICE.log" 2>&1 || true
  fi

  # ── ① 일괄 한 번의 결말 ──────────────────────────────────────────────────────
  # **복구를 기다린 뒤에 물어야 한다.** 컨테이너는 안 죽었다. cgroup OOM 킬러가 거대 INSERT 를
  # 돌리던 백엔드 프로세스를 잡았고, postmaster 가 그것을 감지해 스스로 크래시 복구를 돌린다.
  # 그 사이에 물으면 "the database system is not yet accepting connections" 만 돌아온다.
  # 화면의 순서가 곧 일어난 순서다 — 죽음 → 복구 로그 → 접속 회복 → 남은 알림 0건.
  if [ "$SLICE" = "$BATCH_SLICE" ]; then
    echo
    echo "══════ ① 일괄(조각 $SLICE = 수강생 전원) 한 번의 결말   pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V] ══════"
    show_inspect 'OOMKilled={{.State.OOMKilled}}  mem_limit={{.HostConfig.Memory}}'
    wait_pg_ready   # 복구가 끝나야 셀 수 있다. 끝났다는 사실은 아래 로그의 마지막 줄이 말한다
    # redo 만 걸면 체크포인트 줄의 "redo lsn=" 이 딸려 와 복구 줄을 밀어낸다. starts·done 으로 좁힌다.
    # 한 줄로 두면 216자가 되어 화면에서 접힌다. 줄 이음을 넣어 두 줄로 찍고 eval 이 그대로 실행한다.
    logcmd="docker compose -f $CF logs --no-log-prefix postgres \\
    | grep -E 'not properly shut down|redo (starts|done)|ready to accept' | tail -4"
    echo
    echo "\$ $logcmd"
    eval "$logcmd"
    runq "SELECT count(*) AS 만든_알림 FROM core.notification;"
    runq "SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '$T_WAL0')) AS 버려진_WAL;"
  else
    [ "$PGOOM" = "true" ] && wait_pg_ready
  fi
  N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null || echo 0)"
  [ "$RESULT" = "완료" ] && [ "${N:-0}" -lt "$USERS" ] && RESULT="시간초과"
  OBOX="$(pg -c "SELECT coalesce(max(pg_column_size(payload_json)),0) FROM core.outbox_events WHERE event_type='PUSH_DELIVERY_REQUESTED';" 2>/dev/null || echo 0)"
  WAL="$(pg -c "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '$T_WAL0');" 2>/dev/null || echo 0)"
  compose logs --tail 400 app > "$OUT/app-slice-$SLICE.log" 2>&1 || true
  grep -q OutOfMemoryError "$OUT/app-slice-$SLICE.log" && RESULT="앱 힙 부족(OutOfMemoryError)"

  python3 - "$OUT/summary.csv" "$SLICE" "$RESULT" "$T0" "$T1" "${N:-0}" "$HEAP_MAX" \
           "$ANON_MAX" "$CUR_MAX" "${PG_LIMIT:-0}" "${PGOOM:-false}" "$OBOX" "$WAL" <<'PY'
import sys
f, sl, res, t0, t1, n, heap, anon, cur, lim, oom, obox, wal = sys.argv[1:]
mb = lambda v: f"{int(v)/1048576:.0f}"
open(f, "a").write(f"{sl},{(int(t1)-int(t0))/1000:.2f},{n},{mb(heap)},{mb(anon)},"
                   f"{mb(cur)},{mb(lim)},{oom},{int(obox)/1024:.0f},{int(wal)/1048576:.1f},{res}\n")
PY
done

# ── ② 조각만 바꾼 비교표 ──────────────────────────────────────────────────────
echo
echo "══════ ② 조각 크기만 바꾼 같은 100만 건   앱 힙 $APP_HEAP · 푸시 꺼짐 · 갈래 1 ══════"
echo
echo "\$ column -s, -t < $OUT/summary.csv"
column -s, -t < "$OUT/summary.csv"

# ── 그래프용 표본 ────────────────────────────────────────────────────────────
# 곡선은 화면에 못 찍으므로 초 단위로 추려 텍스트로 낸다. 이 표가 그대로 그래프의 원본이다.
echo
echo "══════ ③ 1초 표본 (pg 익명 메모리 · 앱 힙)   한도 $(( PG_LIMIT / 1048576 ))MB ══════"
python3 - "$OUT" $SLICES <<'PY'
import csv, os, sys
out, slices = sys.argv[1], sys.argv[2:]
cols, series = [], {}
for sl in slices:
    path = os.path.join(out, f"mem-{sl}.csv")
    if not os.path.exists(path):
        continue
    rows = list(csv.DictReader(open(path)))
    if not rows:
        continue
    t0 = int(rows[0]["t_ms"])
    series[sl] = {round((int(r["t_ms"]) - t0) / 1000): r for r in rows}
    cols.append(sl)
if not cols:
    print("  표본이 없다"); raise SystemExit
mb = lambda v: f"{int(v)/1048576:.0f}"
head = ["초"] + [f"{c}_anonMB" for c in cols] + [f"{c}_힙MB" for c in cols]
print("  " + ",".join(head))
last = max(max(s) for s in series.values())
for t in range(0, last + 1):
    cells = [str(t)]
    for c in cols:
        r = series[c].get(t)
        cells.append(mb(r["anon"]) if r else "")
    for c in cols:
        r = series[c].get(t)
        cells.append(mb(r["heap"]) if r else "")
    if any(x for x in cells[1:]):
        print("  " + ",".join(cells))
PY
echo
echo "결과: $OUT"
