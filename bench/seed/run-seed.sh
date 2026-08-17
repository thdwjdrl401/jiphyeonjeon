#!/usr/bin/env bash
#
# 벤치 전용 Postgres를 띄우고, 마이그레이션을 적용하고, 대량 시드를 넣는다.
#
# **운영 DB를 쓰지 않는다.** 운영 컨테이너에 100만 행을 넣으면 그 뒤 모든 측정이
# 운영 데이터와 섞이고, 설정(shared_buffers·autovacuum)도 통제할 수 없다.
#
# 통제하는 것
#   · cpuset 물리 코어 단위 고정 · 메모리 상한 · 스왑 비활성
#   · autovacuum off — 측정 중에 끼어들면 결과가 흔들린다. 실행 사이에 수동 VACUUM
#   · checkpoint_timeout 크게 — 측정 구간에 체크포인트가 안 떨어지게
#   · shared_buffers 등 명시 — 기본값은 버전이 바뀌면 조용히 달라진다
#
# 사용법
#   bench/seed/run-seed.sh [수강생수]        기본 1000000
#   USERS=10000 bench/seed/run-seed.sh       빠른 확인용
#   KEEP=1 bench/seed/run-seed.sh            시드 후 컨테이너를 남긴다(기본 남김)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USERS="${1:-${USERS:-1000000}}"

CONTAINER="bench-postgres"
# 사용자 정의 네트워크를 쓴다. --network host는 macOS Docker Desktop에서
# 호스트 루프백에 닿지 않아 로컬 검증이 불가능하다.
NETWORK="bench-net"
PG_IMAGE="pgvector/pgvector:pg16"
FLYWAY_IMAGE="flyway/flyway:10-alpine"
PGPORT="${PGPORT:-15499}"
PGPASSWORD_VALUE="bench"

# 물리 코어 2개(형제 쌍 통째). lazy 배치: (0,4) (1,5) (2,6) (3,7)
PG_CPUSET="${PG_CPUSET:-0,4,1,5}"
PG_MEMORY="${PG_MEMORY:-2g}"

fail() { echo "실패: $*" >&2; exit 1; }

# ── 준비 ──────────────────────────────────────────────────────────────────
docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK" > /dev/null

echo "▶ Postgres 기동 (cpuset=$PG_CPUSET · mem=$PG_MEMORY · port=$PGPORT)"
docker run -d \
  --name "$CONTAINER" \
  --network "$NETWORK" \
  --cpuset-cpus "$PG_CPUSET" \
  --memory "$PG_MEMORY" --memory-swap "$PG_MEMORY" \
  -e POSTGRES_USER=liveclass \
  -e POSTGRES_PASSWORD="$PGPASSWORD_VALUE" \
  -e POSTGRES_DB=liveclass \
  -p "127.0.0.1:$PGPORT:5432" \
  "$PG_IMAGE" \
  -c shared_buffers=512MB \
  -c work_mem=64MB \
  -c maintenance_work_mem=512MB \
  -c autovacuum=off \
  -c checkpoint_timeout=1h \
  -c max_wal_size=16GB \
  -c synchronous_commit=on \
  -c log_min_duration_statement=1000 \
  > /dev/null

# 게시 포트까지 확인한다. `pg_isready`만 보면 컨테이너 안 유닉스 소켓을 볼 뿐이고,
# 우리는 호스트의 127.0.0.1:PORT로 붙는다. 그 둘이 갈려 "준비 완료" 뒤 연결 거부가 난다.
echo -n "   준비 대기"
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" pg_isready -U liveclass -d liveclass > /dev/null 2>&1; then
    echo " — 완료"; break
  fi
  echo -n "."; sleep 1
done
docker exec "$CONTAINER" pg_isready -U liveclass -d liveclass > /dev/null 2>&1 \
  || fail "Postgres가 준비되지 않았다. docker logs $CONTAINER"

# ── 마이그레이션 ──────────────────────────────────────────────────────────
# 앱을 띄우지 않고 Flyway CLI만 쓴다. 스키마만 필요한데 Spring 컨텍스트를 올릴 이유가 없다.
echo "▶ 마이그레이션 적용 ($(ls "$REPO_ROOT"/backend/src/main/resources/db/migration/*.sql | wc -l)개)"
docker run --rm \
  --network "$NETWORK" \
  -v "$REPO_ROOT/backend/src/main/resources/db/migration:/flyway/sql:ro" \
  "$FLYWAY_IMAGE" \
  -url="jdbc:postgresql://$CONTAINER:5432/liveclass" \
  -user=liveclass -password="$PGPASSWORD_VALUE" \
  -schemas=core -defaultSchema=core \
  -connectRetries=10 \
  migrate | tail -5

# ── 시드 ─────────────────────────────────────────────────────────────────
echo "▶ 시드 (수강생 ${USERS}명)"
docker run --rm -i \
  --network "$NETWORK" \
  -e PGPASSWORD="$PGPASSWORD_VALUE" \
  -v "$REPO_ROOT/bench/seed:/seed:ro" \
  "$PG_IMAGE" \
  psql -h "$CONTAINER" -p 5432 -U liveclass -d liveclass \
       -v users="$USERS" -f /seed/seed.sql

echo
echo "── 접속 정보 ──"
echo "  host=127.0.0.1 port=$PGPORT db=liveclass user=liveclass password=$PGPASSWORD_VALUE"
echo "  psql: PGPASSWORD=$PGPASSWORD_VALUE psql -h 127.0.0.1 -p $PGPORT -U liveclass -d liveclass"
echo "  정리: docker rm -f $CONTAINER"
