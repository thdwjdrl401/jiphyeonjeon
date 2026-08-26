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
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
jval() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }
run() { echo; echo "\$ $1"; shift; "$@" 2>&1 | sed 's/^/  /'; }

start_app() {  # $1 추가 env (문자열)
  compose rm -sf app > /dev/null 2>&1 || true
  APP_HEAP=1g APP_MEM=1600m MOCK_DELAY="$DELAY" \
  SCHEDULING_ENABLED=false CAPTION_ENABLED=false ${1:-} \
    compose up -d --build --wait --wait-timeout 420 app > /dev/null 2>&1 || fail "앱 기동 실패"
}

echo "▶ 준비"
PG_CPUSET="${PG_CPUSET:-0,4,1,5}" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq > /dev/null 2>&1 || fail "인프라 기동 실패"
MOCK_DELAY="$DELAY" compose up -d --force-recreate --wait --wait-timeout 120 mock-push > /dev/null 2>&1
LESSON="$(pg -c "SELECT l.id FROM core.lesson l JOIN core.section s ON s.id = l.section_id
                  WHERE s.curriculum_id = '$CUR' ORDER BY l.id LIMIT 1;")"
[ -n "$LESSON" ] || fail "벤치 커리큘럼의 레슨이 없다 — 시드부터 하라"
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
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push   < /dev/null > /dev/null 2>&1
  curl -s "$MOCK/reset" > /dev/null 2>&1 || true
}

publish() {  # 게시 API 호출. curl 출력을 그대로 흘린다
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
  echo "══════ A. 게시 응답과 첫 발송 ══════"
  reset_state
  publish
  for _ in $(seq 1 60); do
    [ "$(curl -s "$MOCK/stats" | jval delivered)" -gt 0 ] 2>/dev/null && break
    sleep 0.5
  done
  run "psql -c \"<아웃박스 타임라인>\"" pgv -c "$TL_SQL"
  FIRST="$(curl -s "$MOCK/stats" | jval firstAtUnixMs)"
  if [ "${FIRST:-0}" -gt 0 ] 2>/dev/null; then
    run "psql -c \"<게시 커밋에서 첫 푸시까지>\"" pgv -c \
      "SELECT round(extract(epoch from (to_timestamp($FIRST/1000.0) - created_at)) * 1000) AS 첫푸시지연ms
         FROM core.outbox_events ORDER BY id LIMIT 1;"
  else
    echo "  경고: 첫 푸시가 안 잡혔다 — 이 회차는 못 쓴다"
  fi
  compose rm -sf app > /dev/null 2>&1 || true
fi

# ── B. 커밋 후 발행 전 장애 ──────────────────────────────────────────────────
if [[ " $SECTIONS " == *" B "* ]]; then
  echo
  echo "══════ B. 브로커가 내려간 채로 게시 ══════"
  compose rm -sf app > /dev/null 2>&1 || true
  reset_state
  start_app ""
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
  sleep 5
  run "psql -c \"SELECT count(*) FROM core.notification;\"" pgv -c "SELECT count(*) FROM core.notification;"
  compose rm -sf app > /dev/null 2>&1 || true
fi

# ── C. 팬아웃 도중 앱이 죽어도 ───────────────────────────────────────────────
if [[ " $SECTIONS " == *" C "* ]]; then
  echo
  echo "══════ C. 팬아웃 도중 kill -9 ══════"
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
  run "docker compose ps app" compose ps app
  start_app "PUSH_ENABLED=false"
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
