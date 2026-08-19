#!/usr/bin/env bash
#
# idx_notification_unread를 뺄지 말지 — 쓰기에서 내는 값과 읽기에서 아끼는 값을 같이 잰다.
#
# 이 인덱스는 부분 인덱스다(`WHERE read_status = 'UNREAD'`). 논거는 마이그레이션 V23에 적혀 있다 —
# "읽었거나 처리한 알림은 인덱스에서 빠진다. 알림이 아무리 쌓여도 세어야 하는 쪽만 남는다."
# 그 말대로면 알림 1만 건 중 안 읽은 게 3건인 사용자에게 큰 이득이다.
#
# 반대쪽이 있다. **알림은 만들어질 때 전부 UNREAD다.** 넓은 팬아웃 100만 건이면 100만 행이 전부
# 이 인덱스로 들어간다 — 쓰는 순간에는 전혀 부분이 아니다.
#
# 그래서 한쪽만 재면 안 된다.
#
#   쓰기   같은 100만 건 팬아웃을 인덱스 있을 때와 없을 때
#   읽기   알림이 쌓인 사용자의 배지 조회를 읽음 비율별로 (전부 안 읽음 / 90% 읽음 / 99% 읽음)
#
# 읽기 쪽은 지금 시드로는 못 잰다 — 사용자당 알림이 1건이라 어느 인덱스든 즉시 끝난다. 알림이
# 쌓인 사용자를 따로 만든다.
#
# 사용법: bench/run-unread-index.sh
#         NOTIFS=20000 bench/run-unread-index.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
SLICE="${SLICE:-5000}"
NOTIFS="${NOTIFS:-10000}"          # 읽기 측정용 사용자 한 명의 알림 수
OUT="${OUT:-$BENCH/results/unread-$(date +%Y%m%dT%H%M%S)}"
PG_CPUSET_V="${PG_CPUSET:-0,4,1,5}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }

echo "▶ Postgres 기동 (pg $PG_CPUSET_V)"
compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" compose up -d --wait --wait-timeout 300 postgres > /dev/null 2>&1 || fail "기동 실패"
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS · 읽기 측정용 알림 $NOTIFS건"

# 팬아웃 한 갈래(구간 없음)를 도는 프로시저. 쓰기 비용 비교용이라 갈래는 1로 고정한다 —
# 인덱스 유무만 변수로 두려면 동시성이 섞이면 안 된다.
pg -c "
CREATE OR REPLACE PROCEDURE bench_write(p_slice int)
LANGUAGE plpgsql AS \$proc\$
DECLARE
  v_curriculum uuid := '00000000-0000-4000-8000-000000000002';
  v_content    uuid := '3fa8b1c2-0000-3000-8000-000000000001';
  v_prefix     text := 'UNREADIDX:00000000-0000-4000-8000-000000000009:';
  v_cursor     uuid := NULL; v_last uuid; v_dummy uuid[]; v_scanned int;
BEGIN
  LOOP
    WITH slice AS (
        SELECT e.user_id FROM core.enrollment e
        WHERE e.curriculum_id = v_curriculum AND e.status = 'ACTIVE'
          AND (v_cursor IS NULL OR e.user_id > v_cursor)
        ORDER BY e.user_id LIMIT p_slice
    ), content AS (
        INSERT INTO core.notification_content (id, type, severity, title, message, targets, group_key)
        SELECT v_content, 'MATERIAL_PUBLISHED', 'NORMAL', '새 강의 자료', '자료가 올라왔습니다.',
               '{}'::jsonb, 'UNREADIDX'
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
    v_cursor := v_last; COMMIT;
    EXIT WHEN v_scanned < p_slice;
  END LOOP;
END
\$proc\$;" > /dev/null

drop_index()   { pg -c "DROP INDEX IF EXISTS core.idx_notification_unread;" > /dev/null; }
create_index() { pg -c "CREATE INDEX IF NOT EXISTS idx_notification_unread ON core.notification (recipient_id) WHERE read_status = 'UNREAD';" > /dev/null; }

# 알림이 쌓인 사용자 한 명. 읽음 비율을 바꿔 가며 배지 조회를 잰다.
seed_reader() {
  local n="$1" read_pct="$2" reader
  reader="$(pg -c "SELECT user_id FROM core.enrollment
                   WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE'
                   ORDER BY user_id LIMIT 1;")"
  pg -c "DELETE FROM core.notification WHERE recipient_id = '$reader'::uuid;" > /dev/null
  pg -c "INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status, created_at)
         SELECT gen_random_uuid(), '$reader'::uuid, '3fa8b1c2-0000-3000-8000-000000000001'::uuid,
                CASE WHEN i <= ($n * $read_pct / 100) THEN 'READ' ELSE 'UNREAD' END, 'INFO',
                now() - (i || ' seconds')::interval
         FROM generate_series(1, $n) i;" > /dev/null
  pg -c "VACUUM (ANALYZE) core.notification;" > /dev/null
  printf '%s' "$reader"
}

badge_ms() {
  local reader="$1" best=999999 t0 t1 ms
  for _ in 1 2 3 4 5; do
    t0="$(now_ms)"
    pg -c "SELECT count(*) FROM core.notification WHERE recipient_id='$reader'::uuid AND read_status='UNREAD';" > /dev/null
    t1="$(now_ms)"
    ms=$(( t1 - t0 ))
    [ "$ms" -lt "$best" ] && best="$ms"
  done
  printf '%s' "$best"
}

badge_plan() {
  pg -c "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM core.notification
         WHERE recipient_id='$1'::uuid AND read_status='UNREAD';" \
    | grep -E "Index|Seq Scan|Execution Time|Buffers: shared" | head -4 | tr '\n' ' | '
}

# ── 쓰기 ──
echo
echo "════ 쓰기: 같은 100만 건 팬아웃 ════"
printf 'side,variant,value\n' > "$OUT/summary.csv"
for idx in with without; do
  [ "$idx" = "with" ] && create_index || drop_index
  pg -c "TRUNCATE core.notification, core.notification_content CASCADE;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  wal0="$(pg -c 'SELECT pg_current_wal_lsn();')"
  t0="$(now_ms)"
  pg -c "CALL bench_write($SLICE);" > /dev/null
  t1="$(now_ms)"
  wal="$(pg -c "SELECT round((pg_wal_lsn_diff(pg_current_wal_lsn(), '$wal0')/1048576.0)::numeric,1);")"
  sz="$(pg -c "SELECT coalesce(pg_size_pretty(sum(pg_relation_size(indexrelid))), '0')
               FROM pg_stat_user_indexes WHERE indexrelname LIKE 'idx_notification_unread%';")"
  printf '   인덱스 %-8s %6.1f초 · WAL %sMB · 인덱스 크기 %s\n' \
    "$([ "$idx" = with ] && echo 있음 || echo 없음)" "$(python3 -c "print($((t1-t0))/1000)")" "$wal" "$sz"
  echo "write,$idx,$(python3 -c "print($((t1-t0))/1000)")" >> "$OUT/summary.csv"
done

# ── 읽기 ──
echo
echo "════ 읽기: 알림 ${NOTIFS}건인 사용자의 배지 조회 ════"
for pct in 0 90 99; do
  echo
  echo "   읽음 ${pct}%  (안 읽음 $(( NOTIFS * (100 - pct) / 100 ))건)"
  for idx in with without; do
    [ "$idx" = "with" ] && create_index || drop_index
    reader="$(seed_reader "$NOTIFS" "$pct")"
    [ "$idx" = "with" ] && create_index || drop_index
    pg -c "VACUUM (ANALYZE) core.notification;" > /dev/null
    ms="$(badge_ms "$reader")"
    printf '     인덱스 %-8s %4sms   %s\n' \
      "$([ "$idx" = with ] && echo 있음 || echo 없음)" "$ms" "$(badge_plan "$reader" | cut -c1-110)"
    echo "read-$pct,$idx,$ms" >> "$OUT/summary.csv"
  done
done

create_index
echo
echo "인덱스 원복 완료"
echo "결과: $OUT"
