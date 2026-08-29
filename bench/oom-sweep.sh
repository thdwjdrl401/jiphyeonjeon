#!/usr/bin/env bash
#
# 슬라이스 크기만 바꿔 같은 100만 건을 넣고, 회차별 수치를 summary.csv 한 장으로 남긴다.
#
# 나머지는 전부 같다. 체인 1, 같은 코어 배분, 같은 힙, 푸시는 꺼 둔다. 슬라이스 1,100,000 이면
# 한 슬라이스이 수강생 전원이라 그것이 일괄 구조다. 되돌린 브랜치가 필요 없다. 슬라이스 크기가
# 런타임 값이기 때문이다.
#
# **캡처는 이 스크립트가 뜨지 않는다.** 표만 만들어 두고, 화면 캡처는 끝난 뒤 손으로 뜬다.
#
#   column -s, -t < bench/results/oom-<회차>/summary.csv
#
# 죽는 장면 하나를 만드는 것은 bench/oom-break.sh 가 한다. 이쪽은 여러 회차를 돌려
# 슬라이스 크기와 수치의 관계를 내는 것이 목적이다.
#
# **일괄은 여러 번 돈다.** 3회 중 2회 죽었다. 총 메모리는 세 번 다 한도 1500MB 에 닿았고
# 익명 메모리도 857~940MB 로 비슷했다. 커널이 그 지점에서 죽이느냐 회수하느냐가 갈린 것이다.
# 재현되는 것은 "한도에 닿는다" 이고, "강제 종료" 는 그 지점에서 일어날 수 있는 일이다.
#
# **관측은 측정을 느리게 한다.** 실측으로 팬아웃이 18.3초에서 20.976초가 됐다(+15%). 그래서
# 대표 수치는 MON=0 회차에서 얻고, MON=1 회차는 곡선의 모양만 본다.
#
# 사용법
#   bash bench/oom-sweep.sh                                        대표 수치 (관측 꺼짐)
#   MON=1 SLICES="1100000 5000" bash bench/oom-sweep.sh            곡선 (관측 켜짐)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 화면에 상대 경로를 찍으므로 루트에서 돈다. 안 그러면 찍는 경로와 넘기는 경로가 어긋난다.
cd "$REPO_ROOT" || exit 1
CF="bench/compose.bench.yml"
BENCH="$REPO_ROOT/bench"

# **일괄을 마지막에 둔다.** OOM 이 나면 그 뒤 회차가 오염되기 때문이다. 실제로 일괄을 먼저
# 돌린 회차에서, 죽고 남은 페이지 캐시 탓에 다음 회차의 TRUNCATE 가 두 번째 OOM 을 맞았다.
# 맨 끝에 두면 그 뒤에 오염될 회차가 없다.
#
# **순서를 바꿔도 OOM 이 항상 나지는 않는다.** 오늘 세 번 돌려 두 번 죽고 한 번 살았다.
# 같은 조건(시작에 postgres 재생성, 일괄 먼저)에서도 갈렸다. 총 메모리는 세 번 다 한도
# 1500MB 에 닿았고, 익명 메모리도 857~940MB 로 비슷했다. 커널이 그 지점에서 죽이느냐
# 회수하느냐가 갈린 것이다. 재현되는 것은 "한도에 닿는다"이고, "강제 종료"는 그 지점에서
# 일어날 수 있는 일이다. 캡션을 그렇게 써야 한다.
SLICES="${SLICES:-5000 50000 200000 500000 800000 1100000}"
BATCH_REPEAT="${BATCH_REPEAT:-3}"   # 일괄은 여러 번 돈다. OOM 이 매번 나지는 않는다
# **회차 사이를 비워 둔다.** 앱을 내린 뒤 이만큼 아무것도 안 하고 기다린다. Prometheus 는
# 폴링이라 회차가 붙어 있으면 어디까지가 어느 시험인지 흐리고, 지표가 바닥으로 안 내려간 채
# 다음 회차가 시작해 앞 회차의 꼬리가 섞인다. 비워 두면 회차마다 바닥에서 올라가는 모양이
# 나와 그림만 보고도 구분된다.
SETTLE_S="${SETTLE_S:-30}"
# MON=1 이면 exporter 를 확인하고 회차별 시각 범위를 남긴다.
#
# **Prometheus·Grafana 는 여기서 안 띄운다.** 관측 컨테이너가 측정 머신에서 같이 돌면 코어를
# 나눠 쓴다(실측 팬아웃 18.3→20.976초, +15%). 그것들은 LAN 의 다른 기기에 있고 SSH 터널로
# 이 머신의 exporter 를 긁어 간다. 여기 남는 것은 cadvisor 와 postgres-exporter 둘뿐이다.
# cadvisor 는 cgroup 과 /var/lib/docker 를 읽어야 해서 못 옮긴다.
#
# 그래서 이 스크립트는 시각 범위만 ranges.csv 에 남긴다. 주석 달기와 패널 PNG 뽑기는
# Grafana 가 있는 관측 머신에서 bench/render-panels.sh 로 한다.
MON="${MON:-0}"
BATCH_SLICE="${BATCH_SLICE:-1100000}"      # 이 슬라이스이 일괄 구조다(한 슬라이스 = 전원)
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

# 회차별 시각 범위를 남긴다. 관측 머신이 이 값으로 주석을 달고 패널을 뽑는다.
mark_range() {  # $1=슬라이스 $2=시작ms $3=끝ms
  [ "$MON" = "1" ] || return 0
  echo "$1,$2,$3" >> "$OUT/ranges.csv"
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
# 없이 떠서 측정 조건이 달라졌다. 슬라이스 크기가 메시지로 옮겨 가면서 회차마다의 앱 설정도
# 같아졌으므로 env 는 여기서 한 번만 내보낸다.
export PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" APP_CPUSET="$APP_CPUSET_V" \
       APP_HEAP="$APP_HEAP" APP_MEM="$APP_MEM" \
       FANOUT_ENABLED=true PUSH_ENABLED=false CAPTION_ENABLED=false \
       FANOUT_CHAINS=1 FANOUT_CONCURRENCY=8

echo "▶ 인프라 기동 (pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V] 인프라[$INFRA_CPUSET_V] · 힙 $APP_HEAP)"
# **postgres 컨테이너를 다시 만들고 시작한다.** docker inspect 의 OOMKilled 는 컨테이너를 다시
# 만들기 전까지 켜진 채로 남는다. 앞선 실행이 죽여 놨으면 시작 점검이 이번 잔해인지 지난
# 잔해인지 구분하지 못한다. 데이터는 볼륨에 있어 사라지지 않는다.
compose rm -sf postgres app > /dev/null 2>&1 || true
INFRA_SVC="postgres redis rabbitmq mock-push"
PROFILE=""
# **지표 포트를 열어 둔 채로 다시 만들어야 한다.** 이 스크립트는 회차마다 컨테이너를 다시
# 만드는데, METRICS_BIND 가 환경에 없으면 compose 기본값인 127.0.0.1 로 되돌아간다. 그러면
# 다른 기기의 Prometheus 가 붙어 있다가 끊기고, 그 사실을 55분 뒤에야 안다. 실제로 그랬다.
# MON=1 은 관측이 다른 기기에 있다는 뜻이므로 여기서 열어 둔다.
if [ "$MON" = "1" ]; then
  export METRICS_BIND="${METRICS_BIND:-0.0.0.0}"
  # 여기 남는 것은 둘뿐이다. cadvisor 는 cgroup 을 읽어야 해서 못 옮기고, postgres-exporter 는
  # TCP 로만 붙으면 되지만 터널 하나 줄이려고 남긴다. 둘 다 가볍다.
  PROFILE="--profile mon"
  INFRA_SVC="$INFRA_SVC cadvisor postgres-exporter"
  echo "슬라이스,시작ms,끝ms" > "$OUT/ranges.csv"
fi
# shellcheck disable=SC2086
compose $PROFILE up -d --wait --wait-timeout 300 $INFRA_SVC > "$OUT/infra.log" 2>&1 \
  || { tail -20 "$OUT/infra.log" >&2; fail "인프라 기동 실패"; }
if [ "$MON" = "1" ]; then
  curl -sf --max-time 5 http://127.0.0.1:18082/healthz > /dev/null 2>&1 \
    || fail "cAdvisor 가 안 뜬다. 곡선이 목적인 회차라 여기서 멈춘다"
  curl -sf --max-time 5 http://127.0.0.1:19187/metrics > /dev/null 2>&1 \
    || fail "postgres-exporter 가 안 뜬다"
fi
T_SESSION0="$(now_ms)"
[ "$(pg_oomkilled)" = "false" ] \
  || fail "시작부터 OOMKilled=$(pg_oomkilled) 다. 앞 회차 잔해가 남아 있으면 이번 회차를 못 쓴다"
# 이미지는 한 번만 굽는다. 슬라이스 크기가 메시지로 가면서 회차마다 다시 빌드할 이유가 없어졌다.
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
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null 2>&1 \
    || fail "비우기(TRUNCATE)가 실패했다. Postgres 가 성한지 보라 — 이 회차는 못 쓴다"
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



trigger() {  # 체인 1 · 슬라이스 $1 로 넓은 팬아웃 한 건을 아웃박스에 넣는다
  local material; material="$(new_uuid)"
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"$CUR\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"$LESSON\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":null,\"untilUserId\":null,\"sliceLimit\":$1}'::jsonb,
                 'PENDING','oom:$material',0,now(),now(),now());" > /dev/null
}

# 열마다 항목 2 의 문장 하나씩에 걸린다. 그 밖의 것은 안 적는다.
#   슬라이스          1회 처리 인원만 바꿔
#   소요초        결과: 슬라이스을 바꿔도 소요 시간이 같다
#   알림건수      문제: 전량 롤백되어 0건 / 결과: 완료되지 않던 작업이 완료됨
#   앱힙최대MB    원인: 앱 힙은 조건과 무관하다. 병목이 앱이 아니다
#   pg_anon최대MB 원인: 일괄에서만 메모리가 한도까지 오른다
#   pgOOM         문제: 한도를 넘어 강제 종료된다
# 뺀 것 — pg_current 는 anon 을 쓰는 이유를 설명하려던 것이지 본문에 없는 이야기다.
# 아웃박스 행 크기와 WAL 도 항목 2 가 하지 않는 주장이다.
# 한도는 모든 행이 같으므로 열 대신 구간 제목에 적는다.
# **하네스 시계를 쓰지 않는다.** 거기에는 릴레이 폴링 대기(최대 30초)와 완료 확인 주기가
# 섞여, 무슨 슬라이스이든 비슷한 값이 나온다. 그 값으로 "슬라이스을 바꿔도 시간이 같다"를 말하면
# 폴링 대기가 같다는 말밖에 안 된다. core.notification.created_at 은 clock_timestamp() 라
# 첫 행부터 마지막 행까지가 순수 처리 시간이다.
#
# 앱힙최대는 뺀다. 톱니치는 값의 최대치라 GC 시점에 좌우돼 슬라이스이 클수록 작게 나오기도 했다
# (814 → 756 → 692). 힙이 조건과 무관하다는 것은 Grafana 의 JVM 힙 곡선이 보인다.
# 한도대비% 는 뺀다. 익명만 한도로 나눠 63% 가 나오는데, 한도를 채운 것은 익명 + 공유 +
# 캐시다(커널 기록: anon-rss 1,090MB + shmem-rss 373MB + file-rss 59MB = 1,522MB).
# "63%인데 왜 죽나" 라는 질문만 부른다. 총 최고 수위를 그대로 두면 한도와 바로 대볼 수 있다.
echo "슬라이스,처리초,알림건수,pg총최고MB,pg익명최고MB,pgOOM,결과" > "$OUT/summary.csv"
PG_LIMIT="$(cat "$PG_CGROUP/memory.max" 2>/dev/null || echo 0)"
# 한도가 없으면 memory.max 는 "max" 라는 글자다. 그대로 두면 산술에서 깨진다.
case "$PG_LIMIT" in ''|*[!0-9]*) PG_LIMIT=0 ;; esac

# **일괄은 여러 번 돈다.** 한 번만 보이면 재현성이 없어 보이고, 실제로 3회 중 2회 죽었다.
# 몇 번 돌려 몇 번 죽었는지를 적는 것이 사실에 맞다.
RUNLIST=""
for sl in $SLICES; do
  if [ "$sl" = "$BATCH_SLICE" ]; then
    i=1; while [ "$i" -le "$BATCH_REPEAT" ]; do RUNLIST="$RUNLIST $sl"; i=$(( i + 1 )); done
  else
    RUNLIST="$RUNLIST $sl"
  fi
done
BATCH_DIED=0; BATCH_RAN=0; LAST_DIED=0

for SLICE in $RUNLIST; do
  # **비우기 전에 소비자를 내린다.** 워커가 메시지를 미확인으로 쥐고 있으면 purge 뒤에 되돌아온다.
  # 앞 회차가 OOM 이었으면 Postgres 가 아직 복구 중이라 TRUNCATE 도 못 한다. 그것부터 기다린다.
  echo; echo "── 슬라이스 $SLICE ──"
  compose rm -sf app > /dev/null 2>&1 || true
  # 슬라이스 회차끼리는 컨테이너를 그대로 쓴다. 죽지 않으므로 오염될 것이 없고, 앞 회차가 데워 둔
  # 상태가 실제 조건이다. 반면 **일괄은 매번 새 컨테이너에서 돈다** — 3회를 독립 시행으로
  # 세려면 앞 시행의 OOM 잔해(페이지 캐시)가 다음 시행에 남으면 안 된다. 실제로 그것 때문에
  # 다음 회차의 TRUNCATE 가 두 번째 OOM 을 맞은 적이 있다.
  # **앞 회차가 죽었을 때만 다시 만든다.** 일괄 앞에서 매번 다시 만들었더니 빈 cgroup 에서
  # 시작해 회수할 페이지 캐시가 넉넉해졌고, OOM 재현이 3회 중 2회에서 1회로 떨어졌다.
  # 실제 사고는 한동안 서비스하던 Postgres 에서 났다. 그 조건을 지킨다.
  # 반면 죽고 난 뒤에는 반드시 다시 만든다 — 잔해가 남으면 다음 회차의 TRUNCATE 가
  # 두 번째 OOM 을 맞는다.
  if [ "${LAST_DIED:-0}" = "1" ]; then
    compose rm -sf postgres > /dev/null 2>&1 || true
    compose up -d --wait --wait-timeout 300 postgres > "$OUT/pg-up.log" 2>&1 \
      || { tail -20 "$OUT/pg-up.log" >&2; fail "postgres 재생성 실패"; }
    PG_CGROUP="$(cgroup_of postgres || true)"
    [ -n "${PG_CGROUP:-}" ] || fail "재생성 뒤 postgres cgroup 을 못 찾았다"
    LAST_DIED=0
  fi
  wait_pg_ready
  reset_state
  compose up -d --wait --wait-timeout 420 app > "$OUT/app-start.log" 2>&1 \
    || { tail -20 "$OUT/app-start.log" >&2; fail "앱 기동 실패. 위 로그를 보라"; }
  SERIES="$OUT/mem-$SLICE.csv"
  echo "t_ms,anon,file,shmem,current,limit,heap" > "$SERIES"
  ANON_MAX=0; CUR_MAX=0; T0="$(now_ms)"; RESULT="완료"; N=0
  # exporter 의 최고 수위를 회차마다 되돌린다. 누적이면 그래프가 회차별 최고점이 아니라
  # 지금까지의 최고점을 그려, 작은 슬라이스 구간에도 앞 회차의 봉우리가 남는다.
  # 앞 회차의 여유 시간이 끝나 지표가 내려앉은 뒤라 바닥값에서 시작한다.
  [ "$MON" = "1" ] && curl -sf -X POST --max-time 5 http://127.0.0.1:18085/reset > /dev/null 2>&1
  OOMK0="$(oom_kills)"; OOMK0="${OOMK0:-0}"
  trigger "$SLICE"

  # **0.5초로 뜬다.** 1초 간격에서는 죽기 직전 표본(711MB)과 죽은 뒤 표본(4MB) 사이가 비어
  # 어디까지 올라갔는지 알 수 없었다. 건수 조회는 비싸므로 8번에 한 번(약 4초)만 한다.
  for ((t = 0; t < TIMEOUT_S * 2; t++)); do
    H="$(heap_used)"
    if [ -n "$H" ]; then :
    elif ! app_alive; then RESULT="앱 죽음"; break; fi
    ST="$(mem_stat)"; A="${ST%%,*}"; C="$(cat "$PG_CGROUP/memory.current" 2>/dev/null || echo 0)"
    [ "${A:-0}" -gt "$ANON_MAX" ] && ANON_MAX="$A"
    [ "${C:-0}" -gt "$CUR_MAX" ] && CUR_MAX="$C"
    echo "$(now_ms),$ST,${C:-0},${PG_LIMIT:-0},${H:-0}" >> "$SERIES"
    if (( t % 8 == 7 )); then
      if ! N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null)"; then
        OOMK="$(oom_kills)"; [ "${OOMK:-0}" -gt "$OOMK0" ] && break
        N=0
      fi
      [ "${N:-0}" -ge "$USERS" ] && break
    fi
    sleep 0.5
  done
  T1="$(now_ms)"
  # **여기서 곧바로 앱을 내린다.** 1.1M 의 아웃박스 행이 PENDING 으로 남아 있는데 앱을 켜 둔 채
  # 두는 동안 릴레이 폴링이 그 행을 다시 발행했다. 워커가 거대 INSERT 를 한 번 더 돌려
  # 두 번째 OOM 이 났고, 다음 회차가 그 복구와 겹쳐 돌았다(소요초 31.32, 앱힙 944 가 그 값이다).
  # **지우기 전에 받는다.** 아래에서 컨테이너를 지운 뒤 로그를 받고 있었고, 그래서 앱 로그가
  # 0줄이었다. 워커가 DB 연결을 잃고 멈추는 장면이 여기 있어야 한다.
  compose logs --no-log-prefix --tail 400 app > "$OUT/app-slice-$SLICE.log" 2>&1 || true
  compose rm -sf app > /dev/null 2>&1 || true
  mark_range "$SLICE" "$T0" "$T1"
  # 앱을 내린 뒤 비워 둔다. 지표가 바닥으로 내려가야 다음 회차가 바닥에서 올라간다.
  [ "$MON" = "1" ] && sleep "$SETTLE_S"
  OOMK1="$(oom_kills)"; OOMK1="${OOMK1:-0}"
  if [ "$OOMK1" -gt "$OOMK0" ]; then PGOOM=true; else PGOOM=false; fi
  if [ "$SLICE" = "$BATCH_SLICE" ]; then
    BATCH_RAN=$(( BATCH_RAN + 1 ))
    [ "$PGOOM" = "true" ] && BATCH_DIED=$(( BATCH_DIED + 1 ))
  fi
  [ "$PGOOM" = "true" ] && LAST_DIED=1

  if [ "$PGOOM" = "true" ]; then
    RESULT="Postgres OOMKilled → 크래시 복구 · 전량 롤백"
    compose logs --tail 200 postgres > "$OUT/pg-slice-$SLICE.log" 2>&1 || true
  fi

  # 죽었으면 크래시 복구가 끝나야 셀 수 있다.
  [ "$PGOOM" = "true" ] && wait_pg_ready
  N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null || echo 0)"
  # DB 가 찍은 시각으로 순수 처리 시간을 잰다. 행이 없으면(전량 롤백) 잴 것이 없다.
  SPAN="$(pg -c "SELECT coalesce(round(extract(epoch from max(created_at) - min(created_at))::numeric, 2), 0)
                   FROM core.notification;" 2>/dev/null || echo 0)"
  [ "$RESULT" = "완료" ] && [ "${N:-0}" -lt "$USERS" ] && RESULT="시간초과"
  grep -q OutOfMemoryError "$OUT/app-slice-$SLICE.log" 2>/dev/null \
    && RESULT="앱 힙 부족(OutOfMemoryError)"

  python3 - "$OUT/summary.csv" "$SLICE" "$RESULT" "${SPAN:-0}" "${N:-0}" \
           "$CUR_MAX" "$ANON_MAX" "${PGOOM:-false}" <<'PY'
import sys
f, sl, res, span, n, cur, anon, oom = sys.argv[1:]
mb = lambda v: int(v) / 1048576
span_s = f"{float(span):.2f}" if float(span) > 0 else "-"
open(f, "a").write(f"{sl},{span_s},{n},{mb(cur):.0f},{mb(anon):.0f},{oom},{res}\n")
PY
done

echo
echo "  일괄(슬라이스 $BATCH_SLICE) $BATCH_RAN회 중 $BATCH_DIED회 강제 종료"
# ── 곡선은 관측 머신에서 ────────────────────────────────────────────────────
# 여기에는 Prometheus 도 Grafana 도 없다. 회차별 시각 범위만 남기고 끝낸다.
# 관측 머신이 이 범위로 주석을 달고 패널을 PNG 로 뽑는다.
if [ "$MON" = "1" ]; then
  T_SESSION1="$(now_ms)"
  echo
  echo "══════ 곡선용 시각 범위 ══════"
  echo
  column -s, -t < "$OUT/ranges.csv"
  echo
  echo "  세션 전체   $T_SESSION0 ~ $T_SESSION1"
  echo
  echo "  관측 머신에서:"
  echo "    scp lazy:$PWD/$OUT/ranges.csv /tmp/ranges.csv"
  echo "    bash bench/render-panels.sh /tmp/ranges.csv"
fi

echo
echo "  표는 직접 뜬다:  column -s, -t < $OUT/summary.csv"
echo
echo "  결과: $OUT"
