#!/usr/bin/env bash
#
# 체인이 2를 넘으면 왜 손해인지 — DB가 무엇을 기다리는지 본다.
#
# 지금까지 확인된 것: 체인을 늘리면 같은 100만 행에 드는 DB 시간이 2.5배로 부푼다
# (18.1초 → 44.5초). 코어를 더 줘도(2→3) 안 줄었고, pg는 CPU에 굶고 있지도 않았다.
# 외래 키 가설은 기각됐다 — FK를 빼서 multixact을 0으로 만들어도 부풀림이 2.46배 그대로였다.
#
# 그래서 짐작을 그만두고 대기 이벤트를 센다. 부푼 시간이 어디로 갔는지는 이것으로만 갈린다.
#
#   LWLock:WALInsert / WALWrite    WAL 삽입 경합 — 커밋이 잦다는 뜻
#   IO:WALSync                     fsync 대기 — 디스크가 못 따라온다
#   LWLock:BufferContent / Mapping B-트리 페이지 경합 — 무작위 키가 같은 페이지에 몰린다
#   IO:DataFileRead                버퍼 부족 — shared_buffers가 작업 집합보다 작다
#   Lock:*                         행·트랜잭션 잠금
#
# **한 판(round)마다 한 줄**을 내보내고 그 줄에서 활성 백엔드의 대기 이벤트를 읽는다. 연결
# 단위로 세면 HikariCP의 유휴 연결 같은 것이 섞여 분포가 망가진다(전에 그렇게 틀렸다).
#
# 버퍼 통계도 함께 잰다 — 백엔드가 직접 더티 버퍼를 쓰고 있으면(buffers_backend) 그것 자체가
# 병목 신호다.
#
# 사용법: bench/run-waits.sh
#         CHAIN_COUNTS="1 2 4 8" bench/run-waits.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
CHAIN_COUNTS="${CHAIN_COUNTS:-1 2 4}"
SLICE="${SLICE:-5000}"
OUT="${OUT:-$BENCH/results/waits-$(date +%Y%m%dT%H%M%S)}"
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }

echo "▶ Postgres 기동 (pg $PG_CPUSET_V · 조각 $SLICE)"
compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" compose up -d --wait --wait-timeout 300 postgres > /dev/null 2>&1 \
  || fail "Postgres 기동 실패"
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS · shared_buffers $(pg -c 'SHOW shared_buffers;')"

pg -c "
CREATE OR REPLACE PROCEDURE bench_range(p_lo uuid, p_hi uuid, p_slice int)
LANGUAGE plpgsql AS \$proc\$
DECLARE
  v_curriculum uuid := '00000000-0000-4000-8000-000000000002';
  v_content    uuid := '3fa8b1c2-0000-3000-8000-000000000001';
  v_prefix     text := 'WAITS:00000000-0000-4000-8000-000000000009:';
  v_cursor     uuid := p_lo;
  v_last       uuid;
  v_dummy      uuid[];
  v_scanned    int;
BEGIN
  LOOP
    WITH slice AS (
        SELECT e.user_id FROM core.enrollment e
        WHERE e.curriculum_id = v_curriculum AND e.status = 'ACTIVE'
          AND (v_cursor IS NULL OR e.user_id > v_cursor)
          AND (p_hi IS NULL OR e.user_id <= p_hi)
        ORDER BY e.user_id LIMIT p_slice
    ), content AS (
        INSERT INTO core.notification_content (id, type, severity, title, message, targets, group_key)
        SELECT v_content, 'MATERIAL_PUBLISHED', 'NORMAL', '새 강의 자료', '자료가 올라왔습니다.',
               '{}'::jsonb, 'WAITS'
        WHERE EXISTS (SELECT 1 FROM slice) ON CONFLICT (id) DO NOTHING
    ), candidate AS (
        SELECT s.user_id, md5(v_prefix || s.user_id)::uuid AS dedupe_hash FROM slice s
    ), passed AS (
        INSERT INTO core.notification_dedupe (dedupe_hash)
        SELECT c.dedupe_hash FROM candidate c
        ON CONFLICT (dedupe_hash) DO NOTHING RETURNING dedupe_hash
    ), inserted AS (
        INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status)
        SELECT gen_random_uuid(), c.user_id, v_content, 'UNREAD', 'INFO'
        FROM candidate c JOIN passed p ON p.dedupe_hash = c.dedupe_hash
        RETURNING recipient_id
    )
    SELECT (SELECT count(*) FROM slice),
           (SELECT array_agg(recipient_id) FROM inserted),
           (SELECT s.user_id FROM slice s ORDER BY s.user_id DESC LIMIT 1)
      INTO v_scanned, v_dummy, v_last;
    EXIT WHEN v_scanned = 0;
    v_cursor := v_last;
    COMMIT;
    EXIT WHEN v_scanned < p_slice;
  END LOOP;
END
\$proc\$;" > /dev/null

ranges_for() {
  python3 -c "
import sys
n = int(sys.argv[1]); span = 1 << 128
def u(v):
    h = '%032x' % (v - 1)
    return '%s-%s-%s-%s-%s' % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
for i in range(n):
    print('%s|%s' % ('NULL' if i == 0 else \"'\" + u(i * span // n + 1) + \"'\",
                     'NULL' if i == n - 1 else \"'\" + u((i + 1) * span // n) + \"'\"))
" "$1"
}

bg_stats() {
  pg -c "SELECT buffers_checkpoint || ' ' || buffers_clean || ' ' || buffers_backend || ' ' || checkpoints_req
         FROM pg_stat_bgwriter;" 2>/dev/null || echo "0 0 0 0"
}
db_stats() {
  pg -c "SELECT blks_hit || ' ' || blks_read FROM pg_stat_database WHERE datname='liveclass';"
}

printf 'chains,elapsed_s,db_total_s,inflation,active_avg,cpu_pct,wait_pct,buffers_backend,blks_read\n' > "$OUT/summary.csv"
BASE_DB=""

for CHAINS in $CHAIN_COUNTS; do
  echo
  echo "════ 체인 ${CHAINS}개 ════"
  pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content CASCADE;" > /dev/null
  pg -c "VACUUM (ANALYZE) core.notification;" > /dev/null 2>&1 || true
  pg -c "CHECKPOINT;" > /dev/null
  pg -c "SELECT pg_stat_statements_reset();" > /dev/null 2>&1 || true
  read -r bc0 bcl0 bb0 cr0 <<< "$(bg_stats)"
  read -r hit0 read0 <<< "$(db_stats)"

  # 대기 이벤트 샘플러. 한 판마다 한 줄 — 활성 백엔드의 이벤트를 공백으로 이어 붙인다.
  # 활성이 하나도 없으면 빈 줄이고, 그 판도 세어야 분모가 맞는다.
  ( compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qAt <<'SQL' 2>/dev/null
SELECT coalesce(string_agg(coalesce(wait_event_type || ':' || wait_event, 'CPU:running'), ' '), '')
  FROM pg_stat_activity
 WHERE datname = 'liveclass' AND state = 'active' AND pid <> pg_backend_pid()
   AND backend_type = 'client backend'
   AND coalesce(query, '') LIKE 'CALL bench_range%';
\watch 0.1
SQL
  ) > "$OUT/waits-$CHAINS.raw" 2>/dev/null &
  w_pid=$!
  trap 'kill "$w_pid" 2>/dev/null || true' EXIT

  # 체인 PID를 명시적으로 모은다. jobs로 고르면 샘플러가 섞여 들어가 wait이 영영 안 끝난다.
  chain_pids=()
  t0="$(now_ms)"
  while IFS='|' read -r lo hi; do
    compose exec -T -e PGPASSWORD=bench postgres \
      psql -U liveclass -d liveclass -qtA -c "CALL bench_range($lo, $hi, $SLICE);" < /dev/null > /dev/null 2>&1 &
    chain_pids+=($!)
  done <<< "$(ranges_for "$CHAINS")"
  for p in "${chain_pids[@]}"; do wait "$p" 2>/dev/null || true; done
  t1="$(now_ms)"
  kill "$w_pid" 2>/dev/null || true

  read -r bc1 bcl1 bb1 cr1 <<< "$(bg_stats)"
  read -r hit1 read1 <<< "$(db_stats)"
  db_total="$(pg -c "SELECT coalesce(round((sum(total_exec_time)/1000)::numeric,1),0)
                     FROM pg_stat_statements WHERE query LIKE 'WITH slice%';")"

  python3 - "$OUT" "$CHAINS" "$(( t1 - t0 ))" "$db_total" "$BASE_DB" \
            "$(( ${bb1:-0} - ${bb0:-0} ))" "$(( ${read1:-0} - ${read0:-0} ))" <<'PY'
import os, sys
out, chains, ms, db, base, bbackend, blksread = sys.argv[1:8]
sec = int(ms) / 1000
db = float(db)
infl = (db / float(base)) if base else 1.0

raw = os.path.join(out, "waits-%s.raw" % chains)
rounds = 0
events = {}
active_total = 0
for line in open(raw, errors="replace") if os.path.exists(raw) else []:
    line = line.rstrip("\n")
    if line.startswith("-") or "row" in line[:12]:
        continue
    rounds += 1
    toks = line.split()
    active_total += len(toks)
    for t in toks:
        events[t] = events.get(t, 0) + 1

cpu = events.get("CPU:running", 0)
tot = sum(events.values())
active_avg = active_total / rounds if rounds else 0
cpu_pct = 100 * cpu / tot if tot else 0
wait_pct = 100 - cpu_pct if tot else 0

print("   체인 %-2s → %5.1f초 · DB총합 %5.1f초 · 부풀림 %.2fx · 활성 평균 %.2f개 (%d판)"
      % (chains, sec, db, infl, active_avg, rounds))
print("      CPU %.1f%% · 대기 %.1f%%" % (cpu_pct, wait_pct))
for k, v in sorted(events.items(), key=lambda kv: -kv[1])[:8]:
    if k == "CPU:running":
        continue
    print("        %5.1f%%  %s" % (100 * v / tot, k))
print("      백엔드가 쓴 버퍼 %s · 디스크 읽기 %s블록" % (bbackend, blksread))

with open(os.path.join(out, "summary.csv"), "a") as f:
    f.write("%s,%.1f,%.1f,%.2f,%.2f,%.1f,%.1f,%s,%s\n"
            % (chains, sec, db, infl, active_avg, cpu_pct, wait_pct, bbackend, blksread))
PY
  [ -n "$BASE_DB" ] || BASE_DB="$db_total"
done

echo
echo "════ 요약 ════"
column -s, -t "$OUT/summary.csv"
echo
echo "결과: $OUT"
