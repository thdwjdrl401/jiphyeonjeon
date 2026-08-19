#!/usr/bin/env bash
#
# 행당 25.7µs가 어디로 가는지 가른다.
#
# 코어를 더 줘도(pg 2→3코어), 체인을 늘려도(1→8), 조각을 키워도(1,000→5,000) 19초 근처에서
# 막혔다. pg는 CPU에 굶고 있지 않았다 — 코어를 50% 더 줬는데 쓰는 양이 291%에서 그대로였다.
# 남은 것은 **행 하나에 드는 일 자체**이고, 그 안을 아직 안 봤다.
#
# 조각 SQL이 행마다 하는 일은 이렇다.
#
#   md5(접두사 || user_id)          dedupe 키 만들기
#   notification_dedupe 삽입         유니크 인덱스 한 벌
#   gen_random_uuid()               알림 id
#   notification 삽입                pkey + 보조 인덱스 3벌
#   content_id 외래 키 확인
#   수신자 배열 반환(array_agg)      실시간 알림용
#
# 하나씩 빼고 100만 행을 다시 넣어 시간과 WAL을 잰다. **앱을 태우지 않는다** — 여기서 보려는
# 것은 DB가 하는 일이고, 브로커 왕복과 JSON 직렬화가 섞이면 그게 흐려진다.
#
# 뺀 판은 전부 **실제로는 못 쓰는 것**들이다(등록표를 빼면 재배달이 중복을 만든다). 값을 재려는
# 것이지 제안하려는 것이 아니다 — 무엇이 비싼지 알아야 무엇을 바꿀지 정할 수 있다.
#
# 사용법: bench/run-ablation.sh
#         SLICE=5000 VARIANTS="base no_dedupe no_indexes" bench/run-ablation.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
SLICE="${SLICE:-5000}"
VARIANTS="${VARIANTS:-base no_dedupe no_indexes no_fk no_md5 no_uuid no_array minimal}"
OUT="${OUT:-$BENCH/results/ablation-$(date +%Y%m%dT%H%M%S)}"
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
pgf() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -v ON_ERROR_STOP=1 "$@"; }

echo "▶ Postgres 기동 (pg $PG_CPUSET_V · 조각 $SLICE)"
compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" compose up -d --wait --wait-timeout 300 postgres > /dev/null 2>&1 \
  || fail "Postgres 기동 실패"
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS"

# 변형마다 조각 SQL의 조각을 바꾼다. 나머지는 전부 같다.
#   DEDUPE_CTE   등록표에 넣고 통과한 것만 돌려주는 부분
#   JOIN_PASSED  통과자만 고르는 조인
#   HASH_EXPR    dedupe 키 만드는 식
#   ID_EXPR      알림 id
#   ARRAY_EXPR   수신자 배열
variant_sql() {
  local v="$1"
  local dedupe_cte join_passed hash_expr id_expr array_expr
  dedupe_cte="), passed AS (
                INSERT INTO core.notification_dedupe (dedupe_hash)
                SELECT c.dedupe_hash FROM candidate c
                ON CONFLICT (dedupe_hash) DO NOTHING
                RETURNING dedupe_hash"
  join_passed="JOIN passed p ON p.dedupe_hash = c.dedupe_hash"
  hash_expr="md5(v_prefix || s.user_id)::uuid"
  id_expr="gen_random_uuid()"
  array_expr="(SELECT array_agg(recipient_id) FROM inserted)"

  case "$v" in
    base) ;;
    no_dedupe)  dedupe_cte=""; join_passed="" ;;
    no_indexes) ;;                                   # DDL로 처리
    no_fk) ;;                                        # DDL로 처리
    no_md5)     hash_expr="s.user_id" ;;             # 사용자마다 유일한 uuid라 대체가 성립한다
    no_uuid)    id_expr="c.user_id" ;;               # 한 사건 안에서는 유일하다
    no_array)   array_expr="NULL::uuid[]" ;;
    minimal)    dedupe_cte=""; join_passed=""; hash_expr="s.user_id"
                id_expr="c.user_id"; array_expr="NULL::uuid[]" ;;
    *) fail "모르는 변형: $v" ;;
  esac

  cat <<SQL
CREATE OR REPLACE PROCEDURE bench_ablation(p_slice_limit int)
LANGUAGE plpgsql AS \$proc\$
DECLARE
  v_curriculum uuid := '00000000-0000-4000-8000-000000000002';
  v_content    uuid := '3fa8b1c2-0000-3000-8000-000000000001';
  v_prefix     text := 'ABLATION:00000000-0000-4000-8000-000000000009:';
  v_cursor     uuid := NULL;
  v_last       uuid;
  v_scanned    int;
BEGIN
  LOOP
    WITH slice AS (
        SELECT e.user_id
        FROM core.enrollment e
        WHERE e.curriculum_id = v_curriculum
          AND e.status = 'ACTIVE'
          AND (v_cursor IS NULL OR e.user_id > v_cursor)
        ORDER BY e.user_id
        LIMIT p_slice_limit
    ), content AS (
        INSERT INTO core.notification_content (
            id, type, severity, title, message, targets, group_key)
        SELECT v_content, 'MATERIAL_PUBLISHED', 'NORMAL', '새 강의 자료', '자료가 올라왔습니다.',
               '{}'::jsonb, 'ABLATION'
        WHERE EXISTS (SELECT 1 FROM slice)
        ON CONFLICT (id) DO NOTHING
    ), candidate AS (
        SELECT s.user_id, ${hash_expr} AS dedupe_hash
        FROM slice s
    ${dedupe_cte}
    ), inserted AS (
        INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status)
        SELECT ${id_expr}, c.user_id, v_content, 'UNREAD', 'INFO'
        FROM candidate c
        ${join_passed}
        RETURNING recipient_id
    )
    SELECT (SELECT count(*) FROM slice),
           ${array_expr},
           (SELECT s.user_id FROM slice s ORDER BY s.user_id DESC LIMIT 1)
      INTO v_scanned, v_last, v_last;

    EXIT WHEN v_scanned = 0;
    v_cursor := v_last;
    COMMIT;                     -- 운영은 조각마다 커밋한다. WAL flush 비용을 포함해야 한다
    EXIT WHEN v_scanned < p_slice_limit;
  END LOOP;
END
\$proc\$;
SQL
}

# 위 SELECT ... INTO는 컬럼 셋을 두 변수에 넣을 수 없다. 배열은 버리고 커서만 받는다.
fix_into() { sed 's|INTO v_scanned, v_last, v_last;|INTO v_scanned, v_dummy, v_last;|; s|v_scanned    int;|v_scanned    int;\n  v_dummy      uuid[];|'; }

apply_ddl() {
  case "$1" in
    no_indexes)
      pg -c "DROP INDEX IF EXISTS core.idx_notification_recipient;
             DROP INDEX IF EXISTS core.idx_notification_unread;
             DROP INDEX IF EXISTS core.idx_notification_action_required;" > /dev/null ;;
    no_fk|minimal)
      pg -c "ALTER TABLE core.notification DROP CONSTRAINT IF EXISTS notification_partitioned_content_id_fkey;" > /dev/null ;;
  esac
}

revert_ddl() {
  case "$1" in
    no_indexes)
      pg -c "CREATE INDEX IF NOT EXISTS idx_notification_recipient ON core.notification (recipient_id, created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_notification_unread ON core.notification (recipient_id) WHERE read_status = 'UNREAD';
             CREATE INDEX IF NOT EXISTS idx_notification_action_required ON core.notification (recipient_id) WHERE action_status = 'ACTION_REQUIRED';" > /dev/null ;;
    no_fk|minimal)
      pg -c "ALTER TABLE core.notification ADD CONSTRAINT notification_partitioned_content_id_fkey
             FOREIGN KEY (content_id) REFERENCES core.notification_content(id);" > /dev/null ;;
  esac
}

printf 'variant,elapsed_s,rows,us_per_row,wal_mb,wal_bytes_per_row,vs_base\n' > "$OUT/summary.csv"
BASE=""

for v in $VARIANTS; do
  echo
  echo "════ $v ════"
  pg -c "TRUNCATE core.notification, core.notification_content CASCADE;" > /dev/null
  apply_ddl "$v"
  variant_sql "$v" | fix_into > "$OUT/$v.sql"
  pgf -f - < "$OUT/$v.sql" > /dev/null 2>&1 || { echo "   프로시저 생성 실패 — SQL: $OUT/$v.sql"; revert_ddl "$v"; continue; }

  pg -c "VACUUM (ANALYZE) core.notification;" > /dev/null 2>&1 || true
  pg -c "CHECKPOINT;" > /dev/null
  wal0="$(pg -c 'SELECT pg_current_wal_lsn();')"
  t0="$(python3 -c 'import time;print(int(time.time()*1000))')"
  pg -c "CALL bench_ablation($SLICE);" > /dev/null || { echo "   실행 실패"; revert_ddl "$v"; continue; }
  t1="$(python3 -c 'import time;print(int(time.time()*1000))')"
  wal_mb="$(pg -c "SELECT round((pg_wal_lsn_diff(pg_current_wal_lsn(), '$wal0')/1048576.0)::numeric,1);")"
  rows="$(pg -c 'SELECT count(*) FROM core.notification;')"
  revert_ddl "$v"

  python3 - "$OUT/summary.csv" "$v" "$(( t1 - t0 ))" "$rows" "$wal_mb" "$BASE" <<'PY'
import sys
path, v, ms, rows, wal, base = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
sec = ms / 1000
us = (ms * 1000 / rows) if rows else 0
wpr = (wal * 1048576 / rows) if rows else 0
vs = (sec / float(base)) if base else 1.0
with open(path, "a") as f:
    f.write("%s,%.1f,%d,%.2f,%.1f,%.0f,%.2f\n" % (v, sec, rows, us, wal, wpr, vs))
print("   %-11s %6.1f초 · %d행 · 행당 %.2fµs · WAL %.1fMB (행당 %.0fB) · 기준대비 %.2fx"
      % (v, sec, rows, us, wal, wpr, vs))
PY
  [ -n "$BASE" ] || BASE="$(python3 -c "print($(( t1 - t0 ))/1000)")"
done

echo
echo "════ 행당 비용의 내역 ════"
column -s, -t "$OUT/summary.csv"
echo
echo "결과: $OUT"
