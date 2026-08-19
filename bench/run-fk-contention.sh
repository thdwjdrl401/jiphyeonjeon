#!/usr/bin/env bash
#
# 체인을 늘리면 DB 총 시간이 부푸는 것(25.7초 → 46.1초)이 외래 키 때문인지 확인한다.
#
# 삭제법에서 외래 키 확인이 행당 비용의 23%(5.7초)로 나왔다. 그 외래 키가 가리키는
# core.notification_content에는 **행이 하나뿐**이다 — 같은 SQL에서 방금 넣은 그 한 줄이다.
# 외래 키 확인은 참조 대상 행에 KEY SHARE 잠금을 걸므로, 동시에 도는 조각들이 전부 같은 한
# 행을 잠근다. 여러 트랜잭션이 한 행을 잠그면 Postgres는 multixact를 만들고, 그건 비싸다.
#
# 가설: 동시성이 올라갈 때 DB 시간이 부푸는 원인이 이 multixact다.
# 반증 방법: 외래 키를 뺀 채로 같은 스윕을 돌린다. 부풀림이 그대로면 원인은 다른 데 있다.
#
# **앱도 브로커도 태우지 않는다.** psql 세션 N개가 각자 자기 구간을 돈다 — 여기서 보려는 것은
# DB 안의 경합이고, 왕복이 섞이면 그게 흐려진다.
#
# 직접 증거로 pg_stat_slru의 MultiXact 카운터를 함께 잰다. 시간만 보면 "느려졌다"까지고,
# 이 값이 늘어야 "multixact 때문"이 된다.
#
# 사용법: bench/run-fk-contention.sh
#         CHAIN_COUNTS="1 2 4 8" bench/run-fk-contention.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
CHAIN_COUNTS="${CHAIN_COUNTS:-1 2 4}"
SLICE="${SLICE:-5000}"
OUT="${OUT:-$BENCH/results/fk-$(date +%Y%m%dT%H%M%S)}"
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
echo "   수강생 $USERS"

# 구간을 받는 프로시저. 삭제법의 base와 같되 상한이 붙는다.
pg -c "
CREATE OR REPLACE PROCEDURE bench_range(p_lo uuid, p_hi uuid, p_slice int)
LANGUAGE plpgsql AS \$proc\$
DECLARE
  v_curriculum uuid := '00000000-0000-4000-8000-000000000002';
  v_content    uuid := '3fa8b1c2-0000-3000-8000-000000000001';
  v_prefix     text := 'FKTEST:00000000-0000-4000-8000-000000000009:';
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
               '{}'::jsonb, 'FKTEST'
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

# MultiXact SLRU 카운터. 이 값이 늘어야 "multixact 때문"이라고 말할 수 있다.
mx() { pg -c "SELECT coalesce(sum(blks_read + blks_written + blks_hit),0)
              FROM pg_stat_slru WHERE name LIKE 'MultiXact%';"; }

printf 'fk,chains,elapsed_s,db_total_s,inflation,wal_mb,multixact_ops\n' > "$OUT/summary.csv"

for FK in on off; do
  if [ "$FK" = "off" ]; then
    pg -c "ALTER TABLE core.notification DROP CONSTRAINT IF EXISTS notification_partitioned_content_id_fkey;" > /dev/null
  else
    pg -c "ALTER TABLE core.notification DROP CONSTRAINT IF EXISTS notification_partitioned_content_id_fkey;
           ALTER TABLE core.notification ADD CONSTRAINT notification_partitioned_content_id_fkey
             FOREIGN KEY (content_id) REFERENCES core.notification_content(id);" > /dev/null
  fi
  echo
  echo "════════ 외래 키 $FK ════════"
  BASE_DB=""

  for CHAINS in $CHAIN_COUNTS; do
    pg -c "TRUNCATE core.notification, core.notification_content CASCADE;" > /dev/null
    pg -c "VACUUM (ANALYZE) core.notification;" > /dev/null 2>&1 || true
    pg -c "CHECKPOINT;" > /dev/null
    pg -c "SELECT pg_stat_statements_reset();" > /dev/null 2>&1 || true
    pg -c "SELECT pg_stat_reset_shared('slru');" > /dev/null 2>&1 || true
    mx0="$(mx)"
    wal0="$(pg -c 'SELECT pg_current_wal_lsn();')"

    t0="$(now_ms)"
    while IFS='|' read -r lo hi; do
      compose exec -T -e PGPASSWORD=bench postgres \
        psql -U liveclass -d liveclass -qtA -c "CALL bench_range($lo, $hi, $SLICE);" < /dev/null > /dev/null 2>&1 &
    done <<< "$(ranges_for "$CHAINS")"
    wait
    t1="$(now_ms)"

    wal_mb="$(pg -c "SELECT round((pg_wal_lsn_diff(pg_current_wal_lsn(), '$wal0')/1048576.0)::numeric,1);")"
    mx1="$(mx)"
    db_total="$(pg -c "SELECT coalesce(round((sum(total_exec_time)/1000)::numeric,1),0)
                       FROM pg_stat_statements WHERE query LIKE 'WITH slice%';")"
    rows="$(pg -c 'SELECT count(*) FROM core.notification;')"

    python3 - "$OUT/summary.csv" "$FK" "$CHAINS" "$(( t1 - t0 ))" "$db_total" "$wal_mb" \
              "$(( ${mx1:-0} - ${mx0:-0} ))" "$rows" "$BASE_DB" <<'PY'
import sys
path, fk, chains, ms, db, wal, mxops, rows, base = sys.argv[1:10]
sec = int(ms) / 1000
db = float(db)
infl = (db / float(base)) if base else 1.0
with open(path, "a") as f:
    f.write("%s,%s,%.1f,%.1f,%.2f,%s,%s\n" % (fk, chains, sec, db, infl, wal, mxops))
print("   체인 %-2s → %5.1f초 · DB총합 %5.1f초 · 부풀림 %.2fx · WAL %sMB · multixact %s회 · %s행"
      % (chains, sec, db, infl, wal, mxops, rows))
PY
    [ -n "$BASE_DB" ] || BASE_DB="$db_total"
  done
done

# 외래 키를 되돌린다 — 벤치 DB를 망가진 채로 두지 않는다.
pg -c "ALTER TABLE core.notification DROP CONSTRAINT IF EXISTS notification_partitioned_content_id_fkey;
       ALTER TABLE core.notification ADD CONSTRAINT notification_partitioned_content_id_fkey
         FOREIGN KEY (content_id) REFERENCES core.notification_content(id);" > /dev/null

echo
echo "════ 외래 키와 동시성 부풀림 ════"
column -s, -t "$OUT/summary.csv"
echo
echo "읽는 법: fk=on에서만 부풀림이 크고 multixact가 늘면 가설이 맞다."
echo "         fk=off에서도 똑같이 부풀면 원인은 다른 데 있다."
echo
echo "결과: $OUT"
