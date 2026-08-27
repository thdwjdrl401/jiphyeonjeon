#!/usr/bin/env bash
#
# 게시와 알림을 분리한 지금 구조의 근거를 뜬다.
#
# 포트폴리오 "1. 트랜잭션 분리"의 결과 절 두 줄에 대응한다.
#
#   게시 응답이 팬아웃·발송 소요와 무관해졌다        → A
#   커밋 후 발행 전에 장애가 나도 폴링이 발행한다     → B
#   앱이 죽어도 알림이 유실되지 않는다               → C
#
# 해설을 붙이지 않는다. 친 명령과 curl·psql·docker의 출력만 남긴다.
#
# 사용법: bench/run-outbox-evidence.sh
#         SECTIONS="A B" bench/run-outbox-evidence.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
SECTIONS="${SECTIONS:-A B C}"
DELAY="${MOCK_DELAY:-230ms}"
# 앱 코어 배분. 문서(docs/benchmark/README.md)의 첫 발송 1.40초는 shared 실행,
# 즉 앱이 물리 1코어에서 팬아웃과 발송을 다 하는 조건에서 나왔다. 같은 조건으로 둔다.
APP_CPUSET_V="${APP_CPUSET:-2,6}"
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"
INFRA_CPUSET_V="${INFRA_CPUSET:-3,7}"
APP="http://127.0.0.1:18081"
MOCK="http://127.0.0.1:18080"
CUR="00000000-0000-4000-8000-000000000002"
EMAIL="outbox-$(date +%s)@liveclass.test"
PASS="outbox-demo-1234"
OUT="${OUT:-$BENCH/results/outbox-$(date +%Y%m%dT%H%M%S)}"
JAR="$OUT/cookies.txt"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg()  { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
pgv() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass "$@" < /dev/null; }
rmq_queues() { compose exec -T rabbitmq rabbitmqctl list_queues name messages consumers < /dev/null; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
jval() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }
run() { echo; echo "\$ $1"; shift; "$@" 2>&1 | sed 's/^/  /'; }

start_app() {  # 추가 env "KEY=VALUE" 를 인자로 여러 개 받는다
  # **확장 결과는 환경 대입이 아니다.** `FOO=1 ${VAR} cmd` 에서 $VAR가 "K=V"로 풀려도 bash는
  # 그것을 대입이 아니라 명령으로 본다. 그래서 export로 넘긴다.
  compose rm -sf app > /dev/null 2>&1 || true
  (
    export APP_HEAP=1g APP_MEM=1600m MOCK_DELAY="$DELAY" \
           APP_CPUSET="$APP_CPUSET_V" PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
           SCHEDULING_ENABLED=false CAPTION_ENABLED=false
    for kv in "$@"; do [ -n "$kv" ] && export "$kv"; done
    compose up -d --build --wait --wait-timeout 420 app
  ) > "$OUT/app-start.log" 2>&1 \
    || { echo; sed 's/^/  /' "$OUT/app-start.log" >&2; fail "앱 기동 실패. 위 로그를 보라"; }
}

echo "▶ 준비"
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq > /dev/null 2>&1 || fail "인프라 기동 실패"
MOCK_DELAY="$DELAY" compose up -d --force-recreate --wait --wait-timeout 120 mock-push > /dev/null 2>&1
LESSON="$(pg -c "SELECT l.id FROM core.lesson l JOIN core.section s ON s.id = l.section_id
                  WHERE s.curriculum_id = '$CUR' ORDER BY l.id LIMIT 1;")"
[ -n "$LESSON" ] || fail "벤치 커리큘럼의 레슨이 없다. 시드부터 하라"
start_app ""
CSRF="$(curl -s -c "$JAR" "$APP/api/auth/csrf" | jval token)"
curl -s -b "$JAR" -c "$JAR" -X POST "$APP/api/auth/signup" -H 'Content-Type: application/json' \
  -H "X-XSRF-TOKEN: $CSRF" -o /dev/null \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"displayName\":\"아웃박스\",\"role\":\"INSTRUCTOR\"}"
CSRF="$(curl -s -b "$JAR" -c "$JAR" "$APP/api/auth/csrf" | jval token)"
curl -s -b "$JAR" -c "$JAR" -X POST "$APP/api/auth/login" -H 'Content-Type: application/json' \
  -H "X-XSRF-TOKEN: $CSRF" -o "$OUT/login.json" -w '%{http_code}' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | grep -q 200 || fail "로그인 실패"
UID_="$(pg -c "SELECT id FROM core.app_user WHERE email='$EMAIL';")"
pg -c "UPDATE core.curriculum SET instructor_id='$UID_' WHERE id='$CUR';" > /dev/null
echo "   준비 완료"

reset_state() {   # B·C는 앱을 내린 뒤 부른다. 소비 중에 표를 비우면 다음 구간에 섞인다
  pg -c "TRUNCATE core.notification, core.notification_content,
                 core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "DELETE FROM core.material_asset WHERE lesson_id='$LESSON';" > /dev/null
  pg -c "DELETE FROM core.asset WHERE bucket='bench' AND object_key LIKE 'outbox/%';" > /dev/null
  # DLQ까지 비운다. 이전 회차가 남긴 것이 큐 목록에 찍히면 유실 없음을 보이는 캡처에
  # 설명 못 할 숫자가 같이 남는다. **결과를 확인한다**. 앞서 오류를 /dev/null로 버려
  # purge가 안 먹은 것을 캡처에서야 알았다.
  local q left
  for q in notification.fanout notification.push notification.fanout.dlq notification.push.dlq; do
    compose exec -T rabbitmq rabbitmqctl purge_queue "$q" < /dev/null > "$OUT/purge.log" 2>&1 || {
      sed 's/^/  /' "$OUT/purge.log" >&2; fail "$q 비우기 실패"; }
  done
  left="$(compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null \
          | awk '$1 ~ /^notification\./ && $2 > 0 {printf "%s=%s ", $1, $2}')"
  [ -z "$left" ] || fail "비웠는데 남아 있다: $left"
  curl -s "$MOCK/reset" > /dev/null 2>&1 || true
}

publish() {  # 게시 API 호출. curl 출력을 그대로 흘린다
  # 목이 0에서 시작하는지 여기서 본다. 앱이 뜨면서 이전 실행이 남긴 푸시를 소비하면
  # firstAtUnixMs가 이번 게시보다 앞서 박혀 구간 계산이 음수가 된다.
  local d; d="$(curl -s "$MOCK/stats" | jval delivered)"
  [ "${d:-0}" -eq 0 ] 2>/dev/null \
    || fail "게시 전인데 목 수신이 $d 건이다. 이전 실행이 남았으니 이 회차는 못 쓴다"
  local aid csrf; aid="$(new_uuid)"
  pg -c "INSERT INTO core.asset (id, kind, bucket, object_key, original_filename, content_type, status, uploaded_by)
         VALUES ('$aid','MATERIAL','bench','outbox/$aid','x.pptx','application/vnd.ms-powerpoint','UPLOADED','$UID_');" > /dev/null
  csrf="$(curl -s -b "$JAR" -c "$JAR" "$APP/api/auth/csrf" | jval token)"
  echo
  echo "\$ curl -s -o /dev/null -w 'HTTP %{http_code}   응답 %{time_total}초\\n' -X POST \\"
  echo "    $APP/api/instructor/lessons/$LESSON/materials -d '{\"assetId\":\"$aid\"}'"
  curl -s -b "$JAR" -c "$JAR" --max-time 120 -X POST "$APP/api/instructor/lessons/$LESSON/materials" \
    -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: $csrf" -d "{\"assetId\":\"$aid\"}" \
    -o /dev/null -w 'HTTP %{http_code}   응답 %{time_total}초\n' | sed 's/^/  /'
}

TL_SQL="SELECT id, status, attempt_count AS 시도,
       to_char(created_at,  'HH24:MI:SS.MS') AS 커밋,
       to_char(published_at,'HH24:MI:SS.MS') AS 발행,
       round(extract(epoch from published_at - created_at) * 1000) AS 발행지연ms
  FROM core.outbox_events ORDER BY id LIMIT 3;"

# ── A. 커밋에서 발행까지, 그리고 첫 발송 ─────────────────────────────────────
if [[ " $SECTIONS " == *" A "* ]]; then
  echo
  echo "══════ A. 게시 응답   pg[$PG_CPUSET_V] 앱[$APP_CPUSET_V] 인프라[$INFRA_CPUSET_V] · 체인 ${FANOUT_CHAINS:-1}개 ══════"
  compose rm -sf app > /dev/null 2>&1 || true
  reset_state
  start_app "FANOUT_CHAINS=${FANOUT_CHAINS:-1}"
  # **응답 시간 하나만 찍는다.** 이 캡처가 놓이는 자리가 증명할 것은 "게시 응답이 발송을
  # 기다리지 않는다" 하나다. 아웃박스가 커밋 뒤에 발행되는 기제는 B가 보이고, 첫 푸시가
  # 몇 초에 나가는지는 1분 예산의 입력이라 그쪽 자리다.
  publish
  compose rm -sf app > /dev/null 2>&1 || true
fi

# ── B. 커밋 후 발행 전 장애 ──────────────────────────────────────────────────
if [[ " $SECTIONS " == *" B "* ]]; then
  echo
  echo "══════ B. 브로커가 내려간 채로 게시   앱[$APP_CPUSET_V] · 체인 ${FANOUT_CHAINS:-1}개 ══════"
  compose rm -sf app > /dev/null 2>&1 || true
  reset_state
  # **팬아웃 소비자를 꺼 둔 채 시작한다.** 켜 두면 발행되자마자 비워져서 브로커가 실제로
  # 받았는지를 큐 깊이로 볼 수 없다. status='PUBLISHED'는 앱이 스스로 적은 값이라
  # 그것만으로는 브로커 쪽 증거가 안 된다.
  #
  # 스케줄링은 켠다. 이 구간이 증명하려는 것이 릴레이의 30초 폴링인데
  # liveclass.scheduling.enabled=false면 @EnableScheduling이 통째로 꺼져 그 폴링도 안 돈다.
  #
  # **체인 1개로 둔다.** 포트폴리오에서 이 캡처가 놓이는 자리는 트랜잭션 분리 항목이고,
  # uuid 구간 분할은 그보다 뒤에 만들어진 것이다. 기본값 2로 뜨면 사건 하나에 명령 2건이
  # 찍혀, 아직 나오지 않은 구조를 독자가 먼저 보게 된다.
  start_app "SCHEDULING_ENABLED=true" "FANOUT_ENABLED=false" "PUSH_ENABLED=false" \
            "FANOUT_CHAINS=${FANOUT_CHAINS:-1}"
  run "docker compose stop rabbitmq" compose stop rabbitmq
  publish
  sleep 3
  run "psql -c \"<아웃박스 상태>\"" pgv -c \
    "SELECT id, status, attempt_count AS 시도, left(last_error, 58) AS 마지막_오류
       FROM core.outbox_events ORDER BY id LIMIT 3;"
  run "psql -c \"SELECT count(*) FROM core.material_asset WHERE lesson_id='…';\"" pgv -c \
    "SELECT count(*) FROM core.material_asset WHERE lesson_id = '$LESSON';"
  run "docker compose start rabbitmq" compose start rabbitmq
  echo
  echo "\$ # 폴링 주기 30초. 발행될 때까지 기다린다"
  for _ in $(seq 1 240); do
    [ "$(pg -c "SELECT count(*) FROM core.outbox_events WHERE status='PUBLISHED';")" -gt 0 ] && break
    sleep 1
  done
  run "psql -c \"<아웃박스 타임라인>\"" pgv -c "$TL_SQL"
  # 브로커가 실제로 받았는가. 소비자를 꺼 뒀으므로 큐에 그대로 쌓여 있다.
  run "docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers" rmq_queues
  # 이제 팬아웃 소비자를 켠다. 푸시는 계속 꺼 둔다. 이 구간은 푸시를 재지 않고,
  # 켜 두면 큐 목록에 푸시 소비자 수가 함께 찍혀 메시지 수로 읽힌다(열이 안 맞는다).
  start_app "SCHEDULING_ENABLED=true" "PUSH_ENABLED=false" "FANOUT_CHAINS=${FANOUT_CHAINS:-1}"
  TARGET_B="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE';")"
  for _ in $(seq 1 180); do
    [ "$(pg -c 'SELECT count(*) FROM core.notification;')" -ge "$TARGET_B" ] && break
    sleep 1
  done
  run "psql -c \"<수강생 수와 알림 행 수>\"" pgv -c \
    "SELECT (SELECT count(*) FROM core.enrollment
              WHERE curriculum_id='$CUR' AND status='ACTIVE') AS 수강생,
            (SELECT count(*) FROM core.notification) AS 알림_행;"
  compose rm -sf app > /dev/null 2>&1 || true
fi

# ── C. 팬아웃 도중 앱이 죽어도 ───────────────────────────────────────────────
if [[ " $SECTIONS " == *" C "* ]]; then
  echo
  echo "══════ C. 팬아웃 도중 kill -9   앱[$APP_CPUSET_V] ══════"
  compose rm -sf app > /dev/null 2>&1 || true
  reset_state
  start_app "PUSH_ENABLED=false"
  TARGET="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE';")"
  publish
  for _ in $(seq 1 120); do
    [ "$(pg -c 'SELECT count(*) FROM core.notification;')" -gt 50000 ] && break
    sleep 0.3
  done
  MID="$(pg -c 'SELECT count(*) FROM core.notification;')"
  echo
  echo "\$ docker kill -s KILL \$(docker compose ps -q app)     # 알림 $MID 건 시점"
  docker kill -s KILL "$(compose ps -q app)" 2>&1 | sed 's/^/  /'
  run "docker compose ps -a app" compose ps -a app
  # **다시 켜는 명령도 보여야 한다.** 죽인 것만 찍히고 재기동이 안 보이면 독자가 kill 다음에
  # 바로 카운트를 보게 되어 그 사이가 끊긴다. compose가 낸 줄을 그대로 흘린다.
  echo
  echo "\$ docker compose up -d app"
  start_app "PUSH_ENABLED=false"
  grep -E 'Container .*app.*(Created|Started|Running|Healthy)' "$OUT/app-start.log" | sed 's/^/  /'
  for _ in $(seq 1 300); do
    [ "$(pg -c 'SELECT count(*) FROM core.notification;')" -ge "$TARGET" ] && break
    sleep 1
  done
  run "psql -c \"<수강생 수와 알림 수>\"" pgv -c \
    "SELECT (SELECT count(*) FROM core.enrollment
              WHERE curriculum_id='$CUR' AND status='ACTIVE') AS 수강생,
            (SELECT count(*) FROM core.notification) AS 알림,
            (SELECT count(*) FROM core.enrollment
              WHERE curriculum_id='$CUR' AND status='ACTIVE')
          - (SELECT count(*) FROM core.notification) AS 차이;"
fi

echo
echo "결과: $OUT"
