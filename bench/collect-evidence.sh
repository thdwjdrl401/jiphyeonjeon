#!/usr/bin/env bash
#
# 각 항목의 근거를 재현해 파일로 남긴다.
#
# 포트폴리오에 수치만 적으면 읽는 쪽이 확인할 방법이 없다. 여기서 만드는 것은 그 수치가
# 어디서 나왔는지 그대로 보여 주는 원본이다 — 실행한 쿼리, 그 응답, 컨테이너 상태, 서버 로그.
#
# 항목마다 독립이라 필요한 것만 골라 돌릴 수 있다.
#
#   bench/collect-evidence.sh                 # 전부
#   ITEMS="06 05" bench/collect-evidence.sh   # 골라서
#
#   01  재배달이 결과에 드러나지 않는다 (ON CONFLICT)
#   03  일괄 조회 시 Postgres 메모리 초과
#   04  커밋 후 트리거 — 아웃박스 적재에서 발행까지
#   05  알림 행의 크기 구성
#   06  파티션 테이블에 전역 UNIQUE를 걸 수 없다
#   08  슬라이스 SQL 실행 계획
#   11  429 응답 시 재적재 (유실 0)
#   13  발송 중 컨테이너 CPU
#
# **오류를 내는 것이 근거인 항목이 있다**(06은 Postgres가 거절하는 것을 보이는 게 목적이다).
# 그래서 -e를 켜지 않는다. 대신 기동처럼 실패하면 안 되는 자리에는 || fail 을 직접 붙였다.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
ITEMS="${ITEMS:-01 03 04 05 06 08 11 13}"
OUT="${OUT:-$BENCH/results/evidence-$(date +%Y%m%dT%H%M%S)}"
CUR="00000000-0000-4000-8000-000000000002"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg()  { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
pgv() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass "$@" < /dev/null; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
iso_now()  { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
has() { [[ " $ITEMS " == *" $1 "* ]]; }

# 표준 머리말. 어느 항목인지, 무엇을 재현한 것인지 파일 자체가 말하게 둔다.
hdr() { { echo "# $1"; echo "# $(date --iso-8601=seconds 2>/dev/null || date)"; echo; } > "$2"; }

# 넓은 팬아웃 한 건을 아웃박스에 넣는다. $1 슬라이스 크기, $2 untilUserId(없으면 전체)
trigger() {
  local m until_; m="$(new_uuid)"
  until_=$([ -n "${2:-}" ] && echo "\"$2\"" || echo null)
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$m','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"$CUR\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$m\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":null,\"untilUserId\":$until_,\"sliceLimit\":${1:-5000}}'::jsonb,
                 'PENDING','ev:$m',0,now(),now(),now());" > /dev/null
  echo "$m"
}

reset_state() {
  pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push  < /dev/null > /dev/null 2>&1 || true
  curl -s --max-time 5 http://127.0.0.1:18080/reset > /dev/null 2>&1 || true
}

start_app() {  # $1 팬아웃 $2 발송 $3 슬라이스
  compose rm -sf app > /dev/null 2>&1 || true
  APP_HEAP=1g APP_MEM=1600m FANOUT_ENABLED="$1" PUSH_ENABLED="$2" \
  FANOUT_CONCURRENCY=8 PUSH_CONCURRENCY=2 NOTIFICATION_FANOUT_SLICE_SIZE="${3:-5000}" \
    compose up -d --build --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"
}

echo "▶ 인프라 기동"
compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 || fail "인프라 기동 실패"
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE';")"
echo "   수강생 $USERS"

# ── 06. 파티션 테이블에 전역 UNIQUE를 걸 수 없다 ────────────────────────────────
# 한 문장이면 끝난다. 05에서 월 파티셔닝을 채택한 순간 06이 왜 필요했는지가 이 오류다.
if has 06; then
  F="$OUT/06-partition-unique.txt"
  hdr "06 · 파티션 테이블에 (수신자, 이벤트) 전역 UNIQUE를 걸 수 없다" "$F"
  {
    echo "\$ psql -c \"\\d+ core.notification\" | head"
    pgv -c "\d core.notification" 2>&1 | head -20
    echo
    echo "\$ psql -c \"CREATE UNIQUE INDEX ... ON core.notification (recipient_id, content_id)\""
    pgv -v ON_ERROR_STOP=0 -c \
      "CREATE UNIQUE INDEX notification_recipient_content_uk ON core.notification (recipient_id, content_id);" 2>&1
    echo
    echo "-- 파티션 키(created_at)를 포함하면 통과하지만, 그때는 달이 다르면 중복이 통과한다."
    echo "-- 그래서 멱등 처리를 파티션이 아닌 별도 테이블로 옮겼다."
    echo
    echo "\$ psql -c \"\\d core.notification_dedupe\""
    pgv -c "\d core.notification_dedupe" 2>&1 | head -15
  } >> "$F"
  echo "   06 완료"
fi

# ── 05. 알림 행의 크기 구성 ────────────────────────────────────────────────────
if has 05; then
  F="$OUT/05-row-size.txt"
  hdr "05 · 알림 행의 크기 구성 — 문구 분리 전후" "$F"
  { start_app true false 5000 >/dev/null; } 2>/dev/null || true
  reset_state; trigger 5000 "01000000-0000-0000-0000-000000000000" > /dev/null
  sleep 20
  {
    echo "-- 표본: 앞의 uuid 범위 한 조각만 팬아웃한 결과"
    echo "\$ psql -c \"SELECT count(*) FROM core.notification\""
    pg -c "SELECT count(*) FROM core.notification;"
    echo
    echo "-- 지금 구조: 문구는 content 1행, 수신자 행에는 수신자별 값만"
    # 파티션 부모는 자기 데이터를 갖지 않는다. 자식을 합쳐야 실제 크기가 나온다.
    pgv -c "SELECT
        pg_size_pretty((SELECT sum(pg_total_relation_size(relid))
                          FROM pg_partition_tree('core.notification')
                         WHERE isleaf))                                      AS notification,
        pg_size_pretty(pg_total_relation_size('core.notification_content'))  AS content,
        pg_size_pretty(pg_total_relation_size('core.notification_dedupe'))   AS dedupe;" 2>&1
    echo
    echo "-- 문구를 수신자 행마다 저장했을 때의 행 크기 (content 컬럼을 행에 되돌려 계산)"
    pgv -c "SELECT
        round(avg(pg_column_size(n.*)))                                    AS 현재_행_바이트,
        round(avg(pg_column_size(c.title) + pg_column_size(c.message)
                + pg_column_size(c.targets) + pg_column_size(c.group_key))) AS 문구_바이트,
        round(avg(pg_column_size(n.*)) + avg(pg_column_size(c.title) + pg_column_size(c.message)
                + pg_column_size(c.targets) + pg_column_size(c.group_key))) AS 분리전_행_바이트
      FROM core.notification n JOIN core.notification_content c ON c.id = n.content_id;" 2>&1
    echo
    echo "-- content 행 수 (이벤트당 1행)"
    pg -c "SELECT count(*) FROM core.notification_content;"
  } >> "$F"
  echo "   05 완료"
fi

# ── 08. 슬라이스 SQL 실행 계획 ─────────────────────────────────────────────────
if has 08; then
  F="$OUT/08-explain.txt"
  hdr "08 · 슬라이스 SQL 실행 계획 (커서 5,000건)" "$F"
  CUT="$(pg -c "SELECT user_id FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE' ORDER BY user_id OFFSET 500000 LIMIT 1;")"
  {
    echo "-- 커서 이후 5,000명만 훑는지 확인. 커서 = 50만 번째 수강생"
    echo "\$ EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)"
    pgv -c "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
      SELECT e.user_id
        FROM core.enrollment e
       WHERE e.curriculum_id = '$CUR' AND e.status = 'ACTIVE'
         AND e.user_id > '$CUT'
       ORDER BY e.user_id
       LIMIT 5000;" 2>&1
  } >> "$F"
  echo "   08 완료"
fi

# ── 01. 재배달이 결과에 드러나지 않는다 ────────────────────────────────────────
if has 01; then
  F="$OUT/01-idempotent.txt"
  hdr "01 · 같은 명령을 다시 실행해도 삽입 0건 — 재시도가 결과에 드러나지 않는다" "$F"
  reset_state
  M="$(trigger 5000 "01000000-0000-0000-0000-000000000000")"
  sleep 20; N1="$(pg -c 'SELECT count(*) FROM core.notification;')"
  # 같은 이벤트를 다시 발행한다(멱등 키만 다르게 — 큐 재배달과 같은 상황)
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json, status,
           idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         SELECT aggregate_type, aggregate_id, event_type, destination, payload_json, 'PENDING',
                idempotency_key || ':again', 0, now(), now(), now()
           FROM core.outbox_events WHERE aggregate_id='$M' AND event_type='NOTIFICATION_FANOUT_REQUESTED' LIMIT 1;" > /dev/null
  sleep 20; N2="$(pg -c 'SELECT count(*) FROM core.notification;')"
  {
    echo "1회차 실행 후 알림 행   $N1"
    echo "동일 이벤트 재발행 후    $N2"
    echo "증가분                  $(( N2 - N1 ))"
    echo
    echo "-- 중복 제거 테이블이 후보를 먼저 잡고 통과분만 알림 행이 된다."
    echo "\$ psql -c \"SELECT count(*) FROM core.notification_dedupe\""
    pg -c "SELECT count(*) FROM core.notification_dedupe;"
    echo
    echo "-- 응답·로그에는 성공으로 남는다. 주기적으로 재실행하는 구조였다면"
    echo "-- 이 0건 삽입이 매분 반복되면서도 어디에도 드러나지 않는다."
  } >> "$F"
  echo "   01 완료"
fi

# ── 04. 커밋 후 트리거 — 적재에서 발행까지 ─────────────────────────────────────
if has 04; then
  F="$OUT/04-relay.txt"
  hdr "04 · 아웃박스 적재에서 발행까지 걸린 시간" "$F"
  # 표본을 다시 만든다. 여기서 갈라 보는 두 집단이 한 실행 안에 같이 나온다.
  #   notification.fanout — 이 스크립트가 psql로 직접 INSERT한 행. enqueue()를 안 거치므로
  #                         커밋 후 깨우기가 걸리지 않고 폴링을 기다린다.
  #   notification.push   — 팬아웃 워커가 enqueue()로 적재한 행. 깨우기 경로를 탄다.
  reset_state; start_app true false 5000
  trigger 5000 "08000000-0000-0000-0000-000000000000" > /dev/null
  sleep 45
  {
    echo "\$ psql -c \"SELECT ... FROM core.outbox_events WHERE status='PUBLISHED'\""
    pgv -c "SELECT destination,
                   count(*)                                                       AS 건수,
                   round(min(extract(epoch FROM published_at - created_at))*1000) AS 최소_ms,
                   round(percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY extract(epoch FROM published_at - created_at))*1000) AS 중앙_ms,
                   round(max(extract(epoch FROM published_at - created_at))*1000) AS 최대_ms
              FROM core.outbox_events
             WHERE status='PUBLISHED' AND published_at IS NOT NULL
             GROUP BY destination;" 2>&1
    echo
    echo "-- 두 줄이 같은 실행에서 나왔고 경로가 다르다."
    echo "--   notification.fanout : 이 스크립트가 psql로 직접 INSERT — enqueue()를 안 거쳐"
    echo "--                         커밋 후 깨우기가 걸리지 않고 폴링을 기다린 값이다."
    echo "--   notification.push   : 팬아웃 워커가 enqueue()로 적재 — 커밋 후 깨우기 경로."
    echo "-- 폴링만 쓰던 구조에서는 전부 위쪽 값이었다. 지금은 폴링을 30초 안전망으로 둔다."
  } >> "$F"
  echo "   04 완료"
fi

# ── 11. 429 응답 시 재적재 ─────────────────────────────────────────────────────
if has 11; then
  F="$OUT/11-retry-429.txt"
  hdr "11 · 공급자가 429를 30% 비율로 돌려줄 때 최종 유실" "$F"
  # **항목 내내 export 해 둔다.** 뒤에서 compose up app 을 부르면 compose가 mock-push 설정도
  # 함께 맞추는데, 그때 이 값이 없으면 기본값 0으로 되돌려 재생성한다 — 429가 한 번도 안 나온다.
  export MOCK_RATE_429=0.3
  compose up -d --force-recreate --wait --wait-timeout 120 mock-push > /dev/null 2>&1
  reset_state; start_app true false 5000
  trigger 5000 "01000000-0000-0000-0000-000000000000" > /dev/null
  sleep 25
  TARGET="$(pg -c "SELECT count(*) FROM core.push_subscription s
                    WHERE EXISTS (SELECT 1 FROM core.notification n WHERE n.recipient_id = s.user_id);")"
  start_app false true 5000
  # **끝났는지의 기준은 목 서버 수신 건수가 아니다.** 429를 받은 기기는 재적재를 거쳐 다시
  # 오므로, 목이 구독 수를 넘겼어도 아직 못 마친 사람이 남는다. 진행 표의 사람 수가 알림
  # 사람 수에 닿고 큐와 아웃박스가 함께 빌 때까지 기다린다.
  PEOPLE="$(pg -c 'SELECT count(*) FROM core.notification;')"
  for i in $(seq 1 90); do
    DONE_="$(pg -c 'SELECT count(DISTINCT recipient_id) FROM core.notification_push_progress;' 2>/dev/null || echo 0)"
    Q="$(compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null | awk '$1=="notification.push"{print $2}')"
    P="$(pg -c "SELECT count(*) FROM core.outbox_events WHERE destination='notification.push' AND status='PENDING';" 2>/dev/null || echo 0)"
    [ "${DONE_:-0}" -ge "${PEOPLE:-1}" ] && [ "${Q:-0}" -eq 0 ] && [ "${P:-0}" -eq 0 ] && break
    sleep 5
  done
  {
    echo "목 서버 설정 · 응답 통계"
    curl -s --max-time 5 http://127.0.0.1:18080/stats
    echo; echo
    echo "알림을 받은 사람             $(pg -c 'SELECT count(*) FROM core.notification;')"
    echo "그 사람들의 구독(기기) 수     $TARGET"
    echo "남은 푸시 큐                 $(compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null | awk '$1=="notification.push"{print $2}')"
    echo "DLQ                          $(compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null | awk '$1=="notification.push.dlq"{print $2}')"
    echo
    echo "-- 발송을 마친 사람 수 (진행 테이블). 위의 사람 수와 같으면 유실이 없다."
    pg -c "SELECT count(DISTINCT recipient_id) FROM core.notification_push_progress;"
    echo
    echo "-- 재적재된 명령 (멱등 키에 회차가 붙는다)"
    pg -c "SELECT idempotency_key FROM core.outbox_events
            WHERE destination='notification.push' AND idempotency_key LIKE '%:retry:%'
            ORDER BY id LIMIT 5;"
    pg -c "SELECT count(*) FROM core.outbox_events
            WHERE destination='notification.push' AND idempotency_key LIKE '%:retry:%';"
  } >> "$F"
  export MOCK_RATE_429=0
  compose up -d --force-recreate --wait --wait-timeout 120 mock-push > /dev/null 2>&1
  echo "   11 완료"
fi

# ── 13. 발송 중 컨테이너 CPU ───────────────────────────────────────────────────
if has 13; then
  F="$OUT/13-cpu.txt"
  hdr "13 · 발송이 도는 동안의 컨테이너 CPU · 메모리" "$F"
  # 표본이 작으면 발송이 몇 초 만에 끝나 스냅숏이 빈 구간을 찍는다. 범위를 넓게 잡고
  # 도는 동안 2초마다 찍어 앱 CPU가 가장 높았던 회차를 남긴다.
  reset_state; start_app true false 5000
  trigger 5000 "20000000-0000-0000-0000-000000000000" > /dev/null
  sleep 60; start_app false true 5000
  SNAP="$OUT/13-samples.txt"; : > "$SNAP"
  for i in $(seq 1 30); do
    { echo "--- $i ---"; docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' \
        $(compose ps -q app postgres rabbitmq mock-push 2>/dev/null) 2>/dev/null; } >> "$SNAP"
    sleep 2
  done
  {
    echo "\$ docker stats --no-stream   # 발송 중 2초 간격 30회 중 앱 CPU 최고 회차"
    python3 - "$SNAP" <<'PYX'
import sys, re
blocks, cur = [], []
for line in open(sys.argv[1]):
    if line.startswith("---"):
        if cur: blocks.append(cur)
        cur = []
    elif line.strip(): cur.append(line.rstrip())
if cur: blocks.append(cur)
def appcpu(b):
    for l in b:
        if "-app-" in l:
            m = re.search(r'\t([\d.]+)%', l)
            if m: return float(m.group(1))
    return -1
best = max(blocks, key=appcpu) if blocks else []
print("NAME                          CPU %     MEM USAGE / LIMIT")
for l in best: print("  ".join(l.split("\t")))
PYX
    echo
    echo "-- 100%는 논리 코어 1개. 앱은 물리 2코어(논리 4)를 배정받았다."
    echo "-- 공유 자원인 Postgres 사용률이 낮아, 발송 노드를 늘려도 DB가 먼저 막히지 않는다."
  } >> "$F"
  echo "   13 완료"
fi

# ── 03. 일괄 조회 시 Postgres 메모리 초과 ──────────────────────────────────────
# 컨테이너를 죽이므로 맨 마지막에 둔다.
if has 03; then
  F="$OUT/03-oom.txt"
  hdr "03 · 수신자 100만 명을 한 슬라이스로 처리했을 때" "$F"
  reset_state; start_app true false 1100000
  W0="$(pg -c 'SELECT pg_current_wal_lsn();')"
  trigger 1100000 > /dev/null
  OOM=false
  for i in $(seq 1 90); do
    sleep 2
    [ "$(docker inspect "$(compose ps -q postgres)" --format '{{.State.OOMKilled}}' 2>/dev/null)" = "true" ] && { OOM=true; break; }
    [ "$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)" -ge "$USERS" ] && break
  done
  {
    echo "\$ docker inspect \$(docker compose ps -q postgres) --format '{{json .State}}'"
    docker inspect "$(compose ps -q postgres)" --format '{{json .State}}' 2>/dev/null \
      | python3 -m json.tool 2>/dev/null | head -14
    echo
    echo "\$ docker inspect ... --format '{{.HostConfig.Memory}}'  # 컨테이너 메모리 상한"
    docker inspect "$(compose ps -q postgres)" --format '{{.HostConfig.Memory}}' 2>/dev/null \
      | python3 -c "import sys;print('%.0f MiB' % (int(sys.stdin.read().strip())/1048576))" 2>/dev/null
    echo
    echo "\$ docker compose logs postgres | grep -iE 'recovery|not properly shut down'"
    compose logs postgres 2>&1 | grep -iE "recovery in progress|not properly shut down|not yet accepting" | tail -6
    echo
    compose up -d --wait --wait-timeout 300 postgres > /dev/null 2>&1 || true
    sleep 5
    echo "\$ psql -c \"SELECT count(*) FROM core.notification\"   # 크래시 복구 후"
    pg -c "SELECT count(*) FROM core.notification;" 2>&1
    echo
    echo "-- 롤백된 WAL"
    pg -c "SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '$W0'));" 2>&1
  } >> "$F"
  echo "   03 완료 (OOMKilled=$OOM)"
fi

echo
echo "결과: $OUT"
ls -1 "$OUT"
