#!/usr/bin/env bash
#
# 팬아웃 한 번에 DB가 실제로 무슨 일을 하는지 센다.
#
# 지금까지 있던 것은 항목을 하나씩 빼고 잰 분해값(행당 24.68µs 중 등록표 38% 등)뿐이라,
# "그래서 무엇을 몇 번 쓰는가"는 세어 보지 않았다. 여기서 세는 것은 셋이다.
#
#   무엇을 몇 행 쓰는가        pg_stat_user_tables.n_tup_ins
#   그게 인덱스 몇 벌을 건드리나  테이블·인덱스 크기 증가분
#   WAL을 얼마나 만드는가       pg_stat_statements.wal_bytes · LSN 차이
#
# 사용법: bench/run-dbload.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
CHAINS="${CHAINS:-2}"; SLICE="${SLICE:-5000}"
OUT="${OUT:-$BENCH/results/dbload-$(date +%Y%m%dT%H%M%S)}"
CUR="00000000-0000-4000-8000-000000000002"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg()  { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
pgf() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -P pager=off -f "$1" < /dev/null; }
now_ms(){ python3 -c 'import time;print(int(time.time()*1000))'; }
iso_now(){ python3 -c 'import datetime;print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid(){ python3 -c 'import uuid;print(uuid.uuid4())'; }

echo "▶ 기동 (갈래 $CHAINS · 슬라이스 $SLICE)"
PG_CPUSET="${PG_CPUSET:-0,4,1,5}" INFRA_CPUSET="${INFRA_CPUSET:-3,7}" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 || fail "인프라"
compose rm -sf app > /dev/null 2>&1 || true
APP_HEAP=1g APP_MEM=1600m APP_CPUSET="${APP_CPUSET:-2,6}" \
FANOUT_ENABLED=true PUSH_ENABLED=false FANOUT_CONCURRENCY=8 \
  compose up -d --build --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱"

USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='$CUR' AND status='ACTIVE';")"
pg -c "TRUNCATE core.notification, core.notification_content,
              core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1
compose exec -T rabbitmq rabbitmqctl purge_queue notification.push  < /dev/null > /dev/null 2>&1
pg -c "VACUUM (ANALYZE) core.notification;" > /dev/null
pg -c "CHECKPOINT;" > /dev/null
pg -c "SELECT pg_stat_statements_reset();" > /dev/null
pg -c "SELECT pg_stat_reset();" > /dev/null
W0="$(pg -c 'SELECT pg_current_wal_lsn();')"
echo "   수강생 $USERS · 통계 초기화 완료"

# uuid 공간을 구간 수만큼 나눠 한꺼번에 발행한다(운영 경로와 같은 모양).
# 슬라이스 크기와 구간 경계는 메시지가 실어 나르므로 앱 설정으로 넘기지 않는다.
M="$(new_uuid)"
python3 -c "
n=$CHAINS; span=1<<128
def u(v):
    h='%032x'%(v-1); return '%s-%s-%s-%s-%s'%(h[0:8],h[8:12],h[12:16],h[16:20],h[20:32])
for i in range(n):
    print('%s|%s'%('' if i==0 else u(i*span//n), '' if i==n-1 else u((i+1)*span//n)))" \
| { c=0; while IFS='|' read -r lo hi; do
      c=$((c+1))
      a=$([ -n "$lo" ] && echo "\"$lo\"" || echo null)
      b=$([ -n "$hi" ] && echo "\"$hi\"" || echo null)
      pg -c "INSERT INTO core.outbox_events
              (aggregate_type,aggregate_id,event_type,destination,payload_json,status,
               idempotency_key,attempt_count,next_attempt_at,created_at,updated_at)
             VALUES ('material','$M','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
               '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"$CUR\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$M\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":$a,\"untilUserId\":$b,\"sliceLimit\":$SLICE}'::jsonb,
               'PENDING','dbload:$M:$c',0,now(),now(),now());" > /dev/null
    done; }

T0="$(now_ms)"
until [ "$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)" -ge "$USERS" ]; do sleep 2; done
T1="$(now_ms)"
echo "   팬아웃 $(python3 -c "print(($T1-$T0)/1000)")초"
WAL="$(pg -c "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '$W0');")"

cat > /tmp/dbload.sql <<'SQL'
\echo '── 1. 무엇을 몇 행 썼나 ──'
SELECT relname AS 테이블, n_tup_ins AS 삽입행, n_tup_upd AS 갱신, n_tup_del AS 삭제
  FROM pg_stat_user_tables
 WHERE n_tup_ins > 0 AND schemaname = 'core'
 ORDER BY n_tup_ins DESC LIMIT 8;

\echo '── 2. 알림 한 건이 건드리는 인덱스 ──'
SELECT c.relname AS 인덱스, pg_size_pretty(pg_relation_size(c.oid)) AS 크기
  FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname='core' AND t.relname IN ('notification', 'notification_content')
   AND pg_relation_size(c.oid) > 0
 ORDER BY pg_relation_size(c.oid) DESC LIMIT 10;

\echo '── 3. 테이블 본체 크기 ──'
SELECT 'notification' AS 대상,
       pg_size_pretty(pg_relation_size('core.notification')) AS 힙,
       pg_size_pretty(pg_indexes_size('core.notification')) AS 인덱스
UNION ALL
SELECT 'notification_content',
       pg_size_pretty(pg_relation_size('core.notification_content')),
       pg_size_pretty(pg_indexes_size('core.notification_content'));

\echo '── 4. 시간을 가장 많이 쓴 문장 ──'
SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 78) AS 문장,
       calls AS 호출, round(total_exec_time)::bigint AS 총ms,
       rows AS 행, round(wal_bytes/1048576.0, 1) AS WAL_MB,
       shared_blks_dirtied AS 더럽힌블록
  FROM pg_stat_statements
 WHERE query NOT ILIKE '%pg_stat%' AND total_exec_time > 100
 ORDER BY total_exec_time DESC LIMIT 6;

\echo '── 5. WAL 구성 ──'
SELECT round(sum(wal_bytes)/1048576.0,1) AS 총WAL_MB,
       sum(wal_records) AS WAL레코드,
       sum(wal_fpi) AS 전체페이지이미지
  FROM pg_stat_statements;
SQL
compose cp /tmp/dbload.sql postgres:/tmp/dbload.sql > /dev/null 2>&1
{ echo "# 팬아웃 1회의 DB 부하 · 수강생 $USERS · 갈래 $CHAINS · 슬라이스 $SLICE"
  echo "# 소요 $(python3 -c "print(($T1-$T0)/1000)")초 · WAL(LSN 차이) $(python3 -c "print(round($WAL/1048576,1))")MB"
  echo
  pgf /tmp/dbload.sql
} > "$OUT/dbload.txt" 2>&1
cat "$OUT/dbload.txt"
echo "결과: $OUT"
