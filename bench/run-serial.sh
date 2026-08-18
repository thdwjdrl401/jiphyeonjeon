#!/usr/bin/env bash
#
# 순진한 구조가 100만 건에 얼마나 걸리는지 잰다.
#
# 지금 구조를 세우기 전에 무엇을 하지 않기로 했는지는 두 가지로 요약된다.
#
#   알림 만들기   행마다 INSERT 한 문장   →  집합 삽입 한 문장으로
#   푸시 보내기   한 건 보내고 응답 기다림 →  동시 800건
#
# 둘 다 표본으로 재고 100만 건으로 환산한다. 100만 건을 실제로 순차 발송하면 수 시간이라
# 재는 것 자체가 성립하지 않는다 — 표본 구간의 처리율이 일정한지 확인하고 그 값을 쓴다.
#
# 사용법: bench/run-serial.sh
#         ROWS=20000 PUSH_SAMPLE=3000 bench/run-serial.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
ROWS="${ROWS:-20000}"           # 행 단위 INSERT 표본
PUSH_SAMPLE="${PUSH_SAMPLE:-2000}"
TOTAL_USERS="${TOTAL_USERS:-1000000}"
OUT="${OUT:-$BENCH/results/serial-$(date +%Y%m%dT%H%M%S)}"
CUR="00000000-0000-4000-8000-000000000002"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg()  { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
pgv() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass "$@" < /dev/null; }
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
iso_now(){ python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
mock() { curl -s --max-time 5 "http://127.0.0.1:18080$1"; }

echo "▶ 인프라 기동"
PG_CPUSET="${PG_CPUSET:-0,4,1,5}" INFRA_CPUSET="${INFRA_CPUSET:-3,7}" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
  || fail "인프라 기동 실패"
echo "수신자,방식,표본,소요초,초당,100만건_환산초,환산_표기" > "$OUT/summary.csv"

report() {  # $1 방식 $2 표본수 $3 소요ms
  python3 - "$OUT/summary.csv" "$1" "$2" "$3" "$TOTAL_USERS" <<'PY'
import sys
f, how, n, ms, total = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
sec = ms / 1000; rate = n / sec; full = total / rate
h, m = int(full // 3600), int((full % 3600) // 60)
label = (f"{h}시간 {m}분" if h else (f"{m}분 {int(full%60)}초" if m else f"{full:.1f}초"))
open(f, "a").write(f"{total},{how},{n},{sec:.2f},{rate:.1f},{full:.0f},{label}\n")
print(f"   {how:<24} 표본 {n:>7}건 · {sec:6.2f}초 · {rate:8.1f}건/s → 100만 건 {label}")
PY
}

# ── 1. 알림 만들기 ─────────────────────────────────────────────────────────────
# 같은 일을 두 방식으로 시킨다. 행마다 INSERT 한 문장 vs 집합 삽입 한 문장.
# 중복 제거 등록표까지 같이 넣어 실제 슬라이스 SQL과 하는 일을 맞춘다.
echo
echo "══ 알림 만들기 ══"
pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content CASCADE;" > /dev/null
CID="$(new_uuid)"
pg -c "INSERT INTO core.notification_content
        (id, type, severity, title, message, targets, group_key, created_at)
       VALUES ('$CID','MATERIAL_PUBLISHED','INFO','새 자료','x.pptx가 올라왔습니다','{}','g:$CID', now())
       ON CONFLICT DO NOTHING;" > /dev/null

pgv -c "\timing off" > /dev/null 2>&1
T0="$(now_ms)"
pg -c "
DO \$\$
DECLARE r record; h uuid;
BEGIN
  FOR r IN SELECT user_id FROM core.enrollment
            WHERE curriculum_id='$CUR' AND status='ACTIVE'
            ORDER BY user_id LIMIT $ROWS LOOP
    h := md5('serial:' || r.user_id::text)::uuid;
    INSERT INTO core.notification_dedupe (dedupe_hash) VALUES (h) ON CONFLICT DO NOTHING;
    INSERT INTO core.notification (recipient_id, content_id, read_status, action_status, created_at)
    VALUES (r.user_id, '$CID', 'UNREAD', 'INFO', now());
  END LOOP;
END \$\$;" > /dev/null
T1="$(now_ms)"
report "행마다 INSERT" "$ROWS" "$(( T1 - T0 ))"

pg -c "TRUNCATE core.notification, core.notification_dedupe CASCADE;" > /dev/null
T0="$(now_ms)"
pg -c "
WITH candidate AS (
  SELECT user_id, md5('serial:' || user_id::text)::uuid AS h
    FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE'
    ORDER BY user_id LIMIT $ROWS
), passed AS (
  INSERT INTO core.notification_dedupe (dedupe_hash)
  SELECT h FROM candidate ON CONFLICT DO NOTHING RETURNING dedupe_hash
)
INSERT INTO core.notification (recipient_id, content_id, read_status, action_status, created_at)
SELECT c.user_id, '$CID', 'UNREAD', 'INFO', now()
  FROM candidate c JOIN passed p ON p.dedupe_hash = c.h;" > /dev/null
T1="$(now_ms)"
report "집합 삽입 (지금 구조)" "$ROWS" "$(( T1 - T0 ))"

# ── 2. 푸시 보내기 ─────────────────────────────────────────────────────────────
# 동시 상한만 바꾼다. 1이면 한 건 보내고 응답을 기다린 뒤 다음 건으로 간다.
echo
echo "══ 푸시 보내기 ══"
CUTOFF="$(pg -c "SELECT user_id FROM core.enrollment
                  WHERE curriculum_id='$CUR' AND status='ACTIVE'
                  ORDER BY user_id LIMIT 1 OFFSET $PUSH_SAMPLE;")"

run_push() {  # $1 동시 상한 $2 라벨
  compose rm -sf app > /dev/null 2>&1 || true
  APP_HEAP=1g APP_MEM=1600m FANOUT_ENABLED=true PUSH_ENABLED=false \
  PUSH_MAX_IN_FLIGHT="$1" NOTIFICATION_FANOUT_SLICE_SIZE=5000 \
    compose up -d --build --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"
  pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
                 core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push  < /dev/null > /dev/null 2>&1
  mock /reset > /dev/null
  local m; m="$(new_uuid)"
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json, status,
           idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$m','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"$CUR\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$m\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":null,\"untilUserId\":\"$CUTOFF\",\"sliceLimit\":5000}'::jsonb,
                 'PENDING','serial:$m',0,now(),now(),now());" > /dev/null
  until [ "$(pg -c 'SELECT count(*) FROM core.notification;')" -ge "$PUSH_SAMPLE" ]; do sleep 2; done
  local target; target="$(pg -c "SELECT count(*) FROM core.push_subscription s
      WHERE EXISTS (SELECT 1 FROM core.notification n WHERE n.recipient_id = s.user_id);")"

  # 여기서부터가 측정 구간. 발송 리스너를 켜고 목 수신이 멈출 때까지 잰다.
  compose rm -sf app > /dev/null 2>&1 || true
  mock /reset > /dev/null
  APP_HEAP=1g APP_MEM=1600m FANOUT_ENABLED=false PUSH_ENABLED=true \
  PUSH_MAX_IN_FLIGHT="$1" PUSH_CONCURRENCY=1 \
    compose up -d --build --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"
  # **폴링으로 재지 않는다.** 동시 800건이면 2,000여 건이 1초 안에 끝나 2초 간격 폴링으로는
  # 0.05초 같은 값이 나온다. 목 서버가 첫 수신과 마지막 수신 시각을 들고 있으므로 그것을 쓴다.
  local d
  for i in $(seq 1 240); do
    d="$(mock /stats | python3 -c 'import sys,json;print(json.load(sys.stdin)["delivered"])' 2>/dev/null || echo 0)"
    [ "${d:-0}" -ge "$target" ] && break
    sleep 2
  done
  sleep 3
  local span
  span="$(mock /stats | python3 -c 'import sys,json;d=json.load(sys.stdin);print(max(1,d["lastAtUnixMs"]-d["firstAtUnixMs"]))' 2>/dev/null || echo 1)"
  report "$2" "$target" "$span"
}

run_push 1   "한 건씩 순차 발송"
run_push 800 "동시 800건 (지금 구조)"

echo
echo "── 요약 ──"
column -s, -t < "$OUT/summary.csv"
echo "결과: $OUT"
