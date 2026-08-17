#!/usr/bin/env bash
#
# 팬아웃 조각 삽입 시간 측정 — 60초 예산이 닫히는지 판정한다.
#
# 조각 체인이 직렬이므로(조각 N 커밋 → 조각 N+1 발행) 조각당 시간 × 조각 수가
# 예산에서 그대로 빠진다. 푸시 워커를 몇 대 붙이든 이 구간은 안 줄어든다.
#
# 사용법
#   bench/seed/run-seed.sh          # 먼저 시드
#   bench/fanout/run-fanout.sh      # 기본: 조각 1,000명씩 전량
#   SLICE=1000 MAX=50 bench/fanout/run-fanout.sh    # 앞 50조각만 (빠른 확인)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$REPO_ROOT/bench/results/fanout-$(date +%Y%m%dT%H%M%S)}"

CONTAINER="bench-postgres"
NETWORK="bench-net"
PG_IMAGE="pgvector/pgvector:pg16"
PGPASSWORD_VALUE="bench"
SLICE="${SLICE:-1000}"
MAX="${MAX:-2000}"

fail() { echo "실패: $*" >&2; exit 1; }

docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || fail "$CONTAINER 가 안 떠 있다. 먼저 bench/seed/run-seed.sh"

mkdir -p "$OUT"

psql_run() {
  docker run --rm -i --network "$NETWORK" -e PGPASSWORD="$PGPASSWORD_VALUE" \
    -v "$REPO_ROOT/bench/fanout:/fanout:ro" \
    "$PG_IMAGE" psql -h "$CONTAINER" -U liveclass -d liveclass -q "$@"
}

# ── 초기화 ────────────────────────────────────────────────────────────────
# 알림·등록표·문구를 비우고 시작한다. 남아 있으면 등록표가 전부 걸러 inserted=0이 되고,
# 그러면 삽입 비용이 아니라 중복 판정 비용만 재게 된다.
echo "▶ 초기화"
psql_run -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content CASCADE;" \
         -c "CHECKPOINT;" \
         -c "VACUUM (ANALYZE) core.notification, core.notification_dedupe, core.notification_content;"

echo "▶ 프로시저 적재"
psql_run -f /fanout/fanout.sql > /dev/null

# ── 실행 ─────────────────────────────────────────────────────────────────
echo "▶ 측정 (조각 ${SLICE}명 · 최대 ${MAX}조각)"
started="$(date +%s)"
psql_run -c "CALL bench_fanout($SLICE, $MAX);"
elapsed=$(( $(date +%s) - started ))

# ── 결과 ─────────────────────────────────────────────────────────────────
psql_run --csv -c "SELECT * FROM bench_fanout_result ORDER BY slice_no;" > "$OUT/slices.csv"

echo
psql_run -c "
SELECT
  count(*)                                            AS 조각수,
  sum(inserted)                                       AS 삽입행,
  round(avg(elapsed_ms), 2)                           AS 평균ms,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_ms)::numeric, 2)  AS p50ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_ms)::numeric, 2) AS p95ms,
  round(max(elapsed_ms), 2)                           AS 최대ms,
  round(sum(elapsed_ms) / 1000, 1)                    AS 합계초
FROM bench_fanout_result;"

echo "── 60초 예산 판정 ──"
psql_run -t -c "
SELECT
  '조각 ' || count(*) || '개 · DB 안에서만 ' || round(sum(elapsed_ms)/1000, 1) || '초' || chr(10) ||
  '  이 값은 하한이다 — 앱·브로커 왕복과 워커 오버헤드가 빠져 있다' || chr(10) ||
  case when sum(elapsed_ms)/1000 >= 60
       then '  60초 예산 초과. 푸시 워커를 늘려도 못 맞춘다 → 커서 공간 분할 필요'
       else '  60초 예산 안. 남는 예산 ' || round(60 - sum(elapsed_ms)/1000, 1) || '초를 발송이 쓴다'
  end
FROM bench_fanout_result;"

echo
echo "실행 벽시계 ${elapsed}초 · 결과: $OUT/slices.csv"
