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
       VALUES ('$CID','MATERIAL_PUBLISHED','NORMAL','새 자료','x.pptx가 올라왔습니다','{}','g:$CID', now())
       ON CONFLICT DO NOTHING;" > /dev/null

# 서버 안의 루프(plpgsql)로는 순진한 구조를 재지 못한다. 거기엔 왕복도 커밋도 없다.
# 실제로 값을 만드는 것은 **행마다 왕복하고 행마다 커밋하는** 것이므로, 행 수만큼의 독립
# INSERT 문을 파일로 만들어 psql에 먹인다. psql은 한 문장씩 보내고 결과를 기다리며,
# 기본 자동 커밋이라 문장마다 커밋이 하나씩 붙는다.
pg -c "SELECT user_id FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE'
        ORDER BY user_id LIMIT $ROWS;" > "$OUT/users.txt"
python3 - "$OUT/users.txt" "$OUT/serial.sql" "$CID" <<'PY'
import sys, hashlib
src, dst, cid = sys.argv[1:4]
with open(dst, "w") as f:
    for line in open(src):
        u = line.strip()
        if not u: continue
        h = hashlib.md5(("serial:" + u).encode()).hexdigest()
        f.write(f"INSERT INTO core.notification_dedupe (dedupe_hash) VALUES ('{h}'::uuid) ON CONFLICT DO NOTHING;\n")
        f.write(f"INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status) "
                f"VALUES (gen_random_uuid(),'{u}','{cid}','UNREAD','INFO');\n")
PY
compose cp "$OUT/serial.sql" postgres:/tmp/serial.sql > /dev/null 2>&1
T0="$(now_ms)"
compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -q -f /tmp/serial.sql < /dev/null > /dev/null 2>&1
T1="$(now_ms)"
# 정말 들어갔는지 센다. 앞선 회차에서 id 컬럼 누락으로 알림 삽입이 전부 실패했는데도 시간만
# 찍혀 나온 적이 있다 — 중복 제거 삽입만 돌고 있었다.
INS="$(pg -c 'SELECT count(*) FROM core.notification;')"
[ "${INS:-0}" -ge "$ROWS" ] || echo "   경고: $ROWS건 목표인데 알림 $INS건만 들어갔다 — 이 회차는 못 쓴다"
report "행마다 왕복·커밋" "$ROWS" "$(( T1 - T0 ))"

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
INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status)
SELECT gen_random_uuid(), c.user_id, '$CID', 'UNREAD', 'INFO'
  FROM candidate c JOIN passed p ON p.dedupe_hash = c.h;" > /dev/null
T1="$(now_ms)"
report "집합 삽입 (지금 구조)" "$ROWS" "$(( T1 - T0 ))"

# ── 1-b. 선형인지 확인 ────────────────────────────────────────────────────────
# 표본에서 100만 건으로 환산하려면 그 사이 처리율이 유지돼야 한다. 규모가 커지면 인덱스가
# 깊어지고 작업 집합이 캐시를 벗어나므로 유지된다는 보장이 없다. 몇 지점에서 직접 잰다.
if [ "${SCALE:-1}" = "1" ]; then
  echo
  echo "══ 집합 삽입 — 규모별 처리율 ══"
  for N in ${SCALE_POINTS:-20000 100000 500000 1000000}; do
    pg -c "TRUNCATE core.notification, core.notification_dedupe CASCADE;" > /dev/null
    pg -c "CHECKPOINT;" > /dev/null
    T0="$(now_ms)"
    pg -c "
    WITH candidate AS (
      SELECT user_id, md5('serial:' || user_id::text)::uuid AS h
        FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE'
        ORDER BY user_id LIMIT $N
    ), passed AS (
      INSERT INTO core.notification_dedupe (dedupe_hash)
      SELECT h FROM candidate ON CONFLICT DO NOTHING RETURNING dedupe_hash
    )
    INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status)
    SELECT gen_random_uuid(), c.user_id, '$CID', 'UNREAD', 'INFO'
      FROM candidate c JOIN passed p ON p.dedupe_hash = c.h;" > /dev/null
    T1="$(now_ms)"
    INS="$(pg -c 'SELECT count(*) FROM core.notification;')"
    [ "${INS:-0}" -ge "$N" ] || echo "   경고: N=$N 인데 알림 $INS 건만 들어갔다 — 이 회차는 못 쓴다"
    report "집합 삽입 N=$N" "$N" "$(( T1 - T0 ))"
  done
fi

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

if [ "${PUSH:-1}" = "1" ]; then
  run_push 1   "한 건씩 순차 발송"
  run_push 800 "동시 800건 (지금 구조)"
fi

echo
echo "── 요약 ──"
column -s, -t < "$OUT/summary.csv"
echo "결과: $OUT"
