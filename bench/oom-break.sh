#!/usr/bin/env bash
#
# 항목 2 의 깨진 상태를 만든다. 자료 하나를 올려서 일괄 팬아웃을 터뜨리는 데까지다.
#
# **캡처는 이 스크립트가 뜨지 않는다.** 화면에 증거를 찍던 앞 방식은 한 번 돌릴 때마다
# 한 벌씩만 나왔고, 명령 한 줄을 고치려면 5분짜리 측정을 다시 돌려야 했다. 상태는 남는다.
# OOMKilled 플래그, 커널 기록, Postgres 크래시 복구 로그, 알림 0건, 앱 로그, Prometheus 의
# 곡선까지 회차가 끝난 뒤에도 그대로 있다. 그러니 상태만 만들어 두고 캡처는 손으로 뜬다.
#
# 만드는 상태는 이것이다.
#
#   슬라이스 1,100,000 = 수강생 전원 → 삽입 문장 하나가 uuid 100만 개를 array_agg 로 모은다
#   → Postgres 익명 메모리가 한도 1.5GB 에 닿는다 → 백엔드가 강제 종료되고 크래시 복구가
#   돌아 전량 롤백된다 (알림 0건)
#
# **매번 죽지는 않는다.** 같은 조건에서 3회 중 2회 죽었다. 한도에 닿는 것은 재현되고,
# 커널이 그 지점에서 죽이느냐 회수하느냐가 갈린다. 안 죽었으면 그냥 다시 돌린다.
#
# 사용법
#   bash bench/oom-break.sh
#   SLICE=800000 bash bench/oom-break.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
CF="bench/compose.bench.yml"

SLICE="${SLICE:-1100000}"          # 한 슬라이스 = 수강생 전원. 이것이 일괄 구조다
TIMEOUT_S="${TIMEOUT_S:-240}"
APP_HEAP="${APP_HEAP:-1g}"; APP_MEM="${APP_MEM:-1600m}"
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"; APP_CPUSET_V="${APP_CPUSET:-2,6}"; INFRA_CPUSET_V="${INFRA_CPUSET:-3,7}"
CUR="00000000-0000-4000-8000-000000000002"
LESSON="00000000-0000-4000-8000-000000000004"
OUT="${OUT:-bench/results/break-$(date +%Y%m%dT%H%M%S)}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$CF" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
hhmmss() { python3 -c 'import time; print(time.strftime("%H:%M:%S"))'; }

cgroup_of() {
  local id p; id="$(compose ps -q "$1")"; [ -n "$id" ] || return 1
  for p in "/sys/fs/cgroup/system.slice/docker-$id.scope" \
           "/sys/fs/cgroup/docker/$id" "/sys/fs/cgroup/memory/docker/$id"; do
    [ -r "$p/memory.current" ] && { echo "$p"; return 0; }
  done
  return 1
}
# 회차를 가르는 것은 이 카운터다. docker inspect 의 OOMKilled 는 컨테이너를 다시 만들기
# 전까지 켜진 채로 남아, 지난 회차의 죽음을 이번 것으로 읽게 만든다. cgroup v2 의
# memory.events 는 oom_kill 을 누적해서 세므로 앞뒤 차이로 판정한다.
oom_kills() { awk '$1=="oom_kill"{print $2}' "$PG_CGROUP/memory.events" 2>/dev/null; }
app_alive() { [ "$(compose ps -q app | xargs -r docker inspect -f '{{.State.Running}}' 2>/dev/null)" = "true" ]; }
wait_pg_ready() {
  local i
  for i in $(seq 1 180); do pg -c 'SELECT 1;' > /dev/null 2>&1 && return 0; sleep 1; done
  fail "Postgres 가 180초 안에 접속을 받지 않는다"
}

# cpuset 을 인프라보다 먼저 내보낸다. 아래에 두었더니 postgres·rabbitmq 가 코어 배분 없이 떴다.
export PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" APP_CPUSET="$APP_CPUSET_V" \
       APP_HEAP="$APP_HEAP" APP_MEM="$APP_MEM" \
       FANOUT_ENABLED=true PUSH_ENABLED=false CAPTION_ENABLED=false \
       FANOUT_CHAINS=1 FANOUT_CONCURRENCY=8
# 지표 포트를 LAN 으로 연다. 이 스크립트는 컨테이너를 다시 만드는데, METRICS_BIND 가 환경에
# 없으면 compose 기본값 127.0.0.1 로 되돌아가 관측 머신의 Prometheus 가 조용히 끊긴다.
export METRICS_BIND="${METRICS_BIND:-0.0.0.0}"

echo "▶ 상태 만들기 (슬라이스 $SLICE · pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V] 인프라[$INFRA_CPUSET_V] · 힙 $APP_HEAP)"

# postgres 를 다시 만든다. 앞선 실행이 죽여 놨으면 OOMKilled 가 켜진 채로 남아 있어,
# 캡처를 떠도 이번 죽음인지 지난 죽음인지 구분되지 않는다. 데이터는 볼륨에 있어 남는다.
compose rm -sf postgres app > /dev/null 2>&1 || true
compose --profile mon up -d --wait --wait-timeout 300 \
        postgres redis rabbitmq mock-push cadvisor postgres-exporter cgroup-exporter \
        > "$OUT/infra.log" 2>&1 \
  || { tail -20 "$OUT/infra.log" >&2; fail "인프라 기동 실패"; }
for u in http://127.0.0.1:18082/healthz http://127.0.0.1:18085/ http://127.0.0.1:19187/metrics; do
  curl -sf --max-time 5 "$u" > /dev/null 2>&1 || fail "$u 가 안 뜬다. 곡선 없이는 캡처를 못 뜬다"
done

PGC="$(docker inspect "$(compose ps -q postgres)" --format '{{.Name}}' 2>/dev/null | sed 's#^/##')"
[ -n "$PGC" ] || fail "postgres 컨테이너 이름을 못 찾았다"
OOMFLAG="$(docker inspect "$PGC" --format '{{.State.OOMKilled}}' 2>/dev/null)"
[ "$OOMFLAG" = "false" ] || fail "시작부터 OOMKilled=$OOMFLAG 다. 플래그가 깨끗해야 캡처가 이번 것이 된다"
PG_CGROUP="$(cgroup_of postgres || true)"
[ -n "${PG_CGROUP:-}" ] || fail "postgres cgroup 경로를 못 찾았다"
[ -n "$(oom_kills)" ] || fail "memory.events 에 oom_kill 이 없다. 죽었는지 판정을 못 한다"

compose build app > "$OUT/build.log" 2>&1 \
  || { tail -30 "$OUT/build.log" >&2; fail "앱 이미지 빌드 실패"; }
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다. 수강생 0명이면 터질 것이 없다"
echo "   수강생 $USERS · cgroup $PG_CGROUP"

# 표와 큐를 비운다. 앞 회차의 미확인 메시지가 남아 있으면 워커가 그것부터 다시 돌린다.
pg -c "TRUNCATE core.notification, core.notification_content,
              core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null 2>&1 \
  || fail "비우기(TRUNCATE)가 실패했다. Postgres 가 성한지 보라"
pg -c "CHECKPOINT;" > /dev/null
for qn in notification.fanout notification.push notification.fanout.dlq notification.push.dlq; do
  compose exec -T rabbitmq rabbitmqctl purge_queue "$qn" < /dev/null > "$OUT/purge.log" 2>&1 \
    || grep -q 'no queue\|not_found' "$OUT/purge.log" \
    || { cat "$OUT/purge.log" >&2; fail "$qn 비우기 실패"; }
done
LEFT="$(compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null \
        | awk '$1 ~ /^notification\./ && $2 > 0 {printf "%s=%s ", $1, $2}')"
[ -z "$LEFT" ] || fail "비웠는데 남아 있다: $LEFT (소비자가 살아 있지 않은지 보라)"

compose up -d --wait --wait-timeout 420 app > "$OUT/app-start.log" 2>&1 \
  || { tail -20 "$OUT/app-start.log" >&2; fail "앱 기동 실패"; }

# 버려진 WAL 을 재려면 발행 직전 위치가 있어야 한다. 캡처할 때 이 값을 질의에 넣는다.
WAL0="$(pg -c "SELECT pg_current_wal_lsn();")"
OOMK0="$(oom_kills)"; OOMK0="${OOMK0:-0}"
T0="$(now_ms)"; C0="$(hhmmss)"

echo "   자료 올림 (슬라이스 $SLICE) $C0"
MATERIAL="$(new_uuid)"
pg -c "INSERT INTO core.outbox_events
        (aggregate_type, aggregate_id, event_type, destination, payload_json,
         status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES ('material','$MATERIAL','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
               '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"$CUR\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"$LESSON\",\"materialId\":\"$MATERIAL\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":null,\"untilUserId\":null,\"sliceLimit\":$SLICE}'::jsonb,
               'PENDING','break:$MATERIAL',0,now(),now(),now());" > /dev/null \
  || fail "아웃박스 넣기 실패"

# 끝날 때까지 기다린다. 죽거나, 100만 건이 다 들어가거나, 시간이 다 되거나.
DIED=0
for ((t = 0; t < TIMEOUT_S; t++)); do
  OOMK="$(oom_kills)"
  if [ "${OOMK:-0}" -gt "$OOMK0" ]; then DIED=1; break; fi
  if ! app_alive; then break; fi
  # 건수 조회는 exec 한 번이라 pg 코어에 얹힌다. 4초에 한 번만 묻는다.
  # 죽음 판정은 위의 cgroup 파일 읽기가 매초 하므로 늦게 알 일이 없다.
  if (( t % 4 == 3 )); then
    if N="$(pg -c "SELECT count(*) FROM core.notification;" 2>/dev/null)"; then
      [ "${N:-0}" -ge "$USERS" ] && break
    fi
  fi
  sleep 1
done
T1="$(now_ms)"; C1="$(hhmmss)"

# **앱을 지우지 않고 멈춘다.** rm 하면 컨테이너와 함께 로그가 사라져서, 워커가 DB 연결을
# 잃는 장면을 나중에 뜰 수 없다. stop 이면 컨테이너가 남아 logs 가 그대로 나온다.
# 멈추기는 해야 한다. 켜 둔 채로 두면 릴레이 폴링이 PENDING 아웃박스 행을 다시 발행해
# 거대 INSERT 를 한 번 더 돌리고, 두 번째 OOM 이 캡처할 상태를 덮는다.
# **지우기 전에 파일로 받는다.** 다음 회차가 컨테이너를 다시 만들면 이 로그가 사라진다.
# 컨테이너는 stop 이라 지금 회차 안에서는 docker compose logs app 으로도 그대로 나온다.
compose logs --no-log-prefix --timestamps app > "$OUT/app.log" 2>&1 || true
compose stop app > /dev/null 2>&1 || true
[ "$DIED" = "1" ] && wait_pg_ready

echo
if [ "$DIED" = "1" ]; then
  echo "  죽음   예. Postgres 백엔드가 강제 종료됐다"
else
  echo "  죽음   아니오. Postgres 는 강제 종료되지 않았다"
fi
echo "  구간   $C0 ~ $C1   ($T0 ~ $T1)"
echo "  WAL    $WAL0"
echo
echo "  캡처는 직접. 컨테이너와 로그는 이 상태로 남아 있다."
echo "  앱 로그   $OUT/app.log   (다음 회차가 컨테이너를 다시 만들면 컨테이너 쪽은 사라진다)"
echo "  WAL 질의에는 위 $WAL0 을 넣는다."
echo
echo "  결과: $OUT"
