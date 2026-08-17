#!/usr/bin/env bash
#
# 병목을 짐작하지 않고 읽는다.
#
# 지금까지는 cpuset을 바꿔 가며 결과가 달라지는 걸로 병목을 추론했다. 그 방식은 두 가지를
# 못 한다 — 원인을 지목하지 못하고(느려졌다는 사실만 안다), 자원이 섞여 있으면 누구 탓인지
# 가르지 못한다(브로커가 Postgres와 같은 코어를 쓰고 있었다).
#
# 여기서는 네 곳에 계측기를 붙이고 한 번만 돌린다.
#
#   1. pg_stat_activity 대기 이벤트 샘플링 (200ms)
#        DB 백엔드가 매 순간 무엇을 하는지의 분포. 이 하나가 제일 많은 걸 말한다.
#          state=active,  wait=NULL          → 진짜로 CPU를 돌리는 중
#          state=active,  wait=IO:*          → 디스크 대기
#          state=active,  wait=LWLock:*      → DB 내부 경합 (WAL 삽입·버퍼 매핑)
#          state=active,  wait=Lock:*        → 행·트랜잭션 잠금 대기
#          state=idle,    wait=Client:ClientRead → **DB가 앱의 다음 질의를 기다린다**
#        마지막 항목이 핵심이다. 이 비율이 높으면 병목은 DB 밖에 있다.
#
#   2. pg_stat_statements
#        어느 SQL이 DB 시간을 얼마나 먹었는지. 조각 삽입인지, 등록표 갱신인지,
#        진행표 조회인지가 문장 단위로 갈린다.
#
#   3. 큐 깊이 시계열 (1초)
#        단계 사이에서 누가 굶는지. 팬아웃 큐가 늘 비어 있으면 소비자가 남아도는 것이고,
#        쌓이면 소비자가 모자란 것이다.
#
#   4. JFR 실행 샘플
#        앱 CPU가 어느 메서드로 갔는지. "푸시 명령 조립이 비싸다"는 추측을 스택으로 바꾼다.
#
# ── 자원을 완전히 가른다 ──
# run-scale.sh는 INFRA_CPUSET을 pg와 같은 값으로 넘겨 브로커·Redis·목서버가 Postgres와
# 코어를 나눠 썼다. 그래서 "pg 3코어"는 실제로 "pg+브로커 3코어"였고, 느려졌을 때 누구
# 탓인지 가를 수 없었다. 여기서는 셋을 분리한다.
#
#   앱 3인스턴스  2,6      (물리 1코어 공유)
#   Postgres      0,4,1,5  (물리 2코어 전용)
#   브로커·기타   3,7      (물리 1코어 전용)
#
# JFR은 샘플링 오버헤드가 붙는다. 이 실행의 소요 시간을 처리량 비교값으로 인용하지 말 것 —
# 여기서 얻는 것은 시간이 아니라 시간의 내역이다.
#
# 사용법: bench/run-probe.sh          (기본 3인스턴스)
#         INSTANCES=1 bench/run-probe.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
N="${INSTANCES:-3}"
OUT="${OUT:-$BENCH/results/probe-$(date +%Y%m%dT%H%M%S)}"
STALL_SECONDS="${STALL_SECONDS:-120}"

PG_CPUSET_V="0,4,1,5"   # 물리 2코어 전용
INFRA_CPUSET_V="3,7"    # 물리 1코어 전용 — 브로커를 pg에서 떼어낸다
APP_CPUSET_V="2,6"      # 물리 1코어를 인스턴스가 공유
PG_PHYS=2
APP_PHYS=1

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }

compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
# 인스턴스가 정말 같은 코드를 도는지 확인한다. 이미지 태그를 묶어도 낡은 컨테이너가
# 남아 있으면 다시 갈릴 수 있고, 갈리면 아무 수치도 못 쓴다 — 실제로 app만 옛 이미지를
# 돌아 푸시가 안 꺼지고 체인 경계도 안 먹은 실행을 통째로 버렸다.
assert_same_image() {
  local ids n
  ids="$(docker inspect --format '{{.Image}}' $(compose ps -q "$@" 2>/dev/null) 2>/dev/null | sort -u)"
  n="$(printf '%s\n' "$ids" | grep -c .)"
  [ "$n" -eq 1 ] || fail "앱 인스턴스가 서로 다른 이미지를 돈다 ($n종). 측정이 성립하지 않는다."
  printf '%s' "$ids"
}

pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }

if [ "${SKIP_ISOLATION:-0}" != "1" ]; then
  others="$(docker ps --format '{{.Names}}' | grep -v '^liveclass-bench' || true)"
  [ -z "$others" ] || fail "벤치 외 컨테이너: $(echo "$others" | paste -sd, -)"
fi

case "$N" in
  1) profile=""; services=(app) ;;
  2) profile="scale2"; services=(app app2) ;;
  3) profile="scale3"; services=(app app2 app3) ;;
  *) fail "지원하지 않는 인스턴스 수: $N" ;;
esac

# 앱 인스턴스가 물리 1코어(논리 2개)를 **정확히 등분**해 나눠 갖는다. cpuset만으로는
# 셋이 한 코어 위에서 서로 훔치므로 "인스턴스 하나가 얼마를 썼나"가 흐려진다. 쿼터를
# 걸면 각자 예산이 따로라 서로 훔칠 수 없고, 대신 예산에 닿으면 멈춘다(throttle.csv로 확인).
APP_CPUS_EACH="$(python3 -c "print('%.2f' % (2.0 / $N))")"

echo "▶ 인프라 기동 (pg $PG_CPUSET_V 전용 · 브로커 $INFRA_CPUSET_V 전용 · 앱 $APP_CPUSET_V)"
echo "   앱 인스턴스당 쿼터 ${APP_CPUS_EACH} CPU (물리 1코어를 ${N}등분)"
compose down > /dev/null 2>&1 || true
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
  compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
  || fail "인프라 기동 실패"

pg -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" > /dev/null \
  || fail "pg_stat_statements를 못 만든다. shared_preload_libraries가 반영되려면 컨테이너 재생성이 필요하다."

USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${USERS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS · 인스턴스 $N개"

echo "▶ 초기화"
pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
              core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
pg -c "CHECKPOINT;" > /dev/null
compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true

# 앱을 띄운다. 발송은 끄고 팬아웃만 — 구간을 섞으면 어느 층의 내역인지 다시 흐려진다.
args=(up -d --build --wait --wait-timeout 300 "${services[@]}")
[ -z "$profile" ] || args=(--profile "$profile" "${args[@]}")
PG_CPUSET="$PG_CPUSET_V" INFRA_CPUSET="$INFRA_CPUSET_V" \
APP_CPUSET="$APP_CPUSET_V" APP2_CPUSET="$APP_CPUSET_V" APP3_CPUSET="$APP_CPUSET_V" \
PG_CPUS="$(( PG_PHYS * 2 ))" INFRA_CPUS=2 APP_CPUS="$APP_CPUS_EACH" \
APP_HEAP="${APP_HEAP:-1g}" APP_MEM="${APP_MEM:-1600m}" \
FANOUT_ENABLED=true PUSH_ENABLED=false \
JFR_OPTS="-XX:StartFlightRecording=settings=profile,filename=/tmp/app.jfr,dumponexit=true" \
  compose "${args[@]}" > /dev/null 2>&1 || fail "앱 기동 실패"

IMG="$(assert_same_image "${services[@]}")"
echo "   앱 이미지 $(printf %s "$IMG" | cut -c8-19) (인스턴스 $N개 동일)"

pg -c "SELECT pg_stat_statements_reset();" > /dev/null

# ── 계측기 기동 ──
# 대기 이벤트: psql 한 세션이 \watch로 돈다. 200ms마다 docker exec를 부르면 그 비용이
# 측정을 흔든다. 자기 자신은 pid로 제외한다.
# **연결이 아니라 실행 중인 백엔드를 센다.** 첫 판은 pg_stat_activity의 행을 그대로
# 셌는데, HikariCP 풀의 쓰이지도 않은 유휴 연결(앱 3개 × 10개)이 전부
# Client:ClientRead로 잡혀 "DB가 앱을 기다린 시간 94%"라는 과장된 값이 나왔다.
# 한 판(round)마다 한 줄을 내보내고 그 줄에서 동시 실행 백엔드 수를 읽는다.
( compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qAt <<'SQL' 2>/dev/null
SELECT count(*) FILTER (WHERE state = 'active' AND wait_event IS NULL)
   || '|' || count(*) FILTER (WHERE state = 'active' AND wait_event IS NOT NULL)
   || '|' || count(*) FILTER (WHERE state = 'idle in transaction')
   || '|' || count(*) FILTER (WHERE state = 'idle')
   || '|' || coalesce(string_agg(wait_event_type || ':' || wait_event, ' ')
                        FILTER (WHERE state = 'active' AND wait_event IS NOT NULL), '')
  FROM pg_stat_activity
 WHERE datname = 'liveclass' AND pid <> pg_backend_pid()
   AND backend_type = 'client backend'
   -- 진행률을 보는 폴링(2초마다 count)이 표본에 섞이면 DB가 일한 것처럼 보인다.
   AND coalesce(query, '') NOT LIKE '%FROM core.notification;%'
   AND coalesce(query, '') NOT LIKE '%pg_stat%';
\watch 0.2
SQL
) > "$OUT/waits.raw" 2>/dev/null &
wait_pid=$!

printf 'ts,fanout,push\n' > "$OUT/queues.csv"
( set +e +o pipefail
  while :; do
    d=$(compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null)
    f=$(echo "$d" | awk '$1=="notification.fanout"{print $2}')
    p=$(echo "$d" | awk '$1=="notification.push"{print $2}')
    echo "$(date +%s),${f:-0},${p:-0}" >> "$OUT/queues.csv"
    sleep 1
  done ) &
q_pid=$!

printf 'ts,container,cpu_pct\n' > "$OUT/cpu.csv"
( set +e +o pipefail
  while :; do
    docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null \
      | awk -v t="$(date +%s)" '{gsub(/%/,"",$2); print t "," $1 "," $2}' >> "$OUT/cpu.csv"
    sleep 2
  done ) &
c_pid=$!
trap 'kill "$wait_pid" "$q_pid" "$c_pid" 2>/dev/null || true' EXIT

# ── 트리거 ── 체인 수 = 인스턴스 수
echo "▶ 트리거 (체인 $N개)"
material="$(new_uuid)"
ranges="$(python3 -c "
import sys
n = int(sys.argv[1]); span = 1 << 128
def u(v):
    h = '%032x' % (v - 1)
    return '%s-%s-%s-%s-%s' % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
for i in range(n):
    print('%s|%s' % ('' if i == 0 else u(i * span // n + 1),
                     '' if i == n - 1 else u((i + 1) * span // n)))
" "$N")"
c=0
while IFS='|' read -r lo hi; do
  c=$(( c + 1 ))
  after=$([ -n "$lo" ] && echo "\"$lo\"" || echo null)
  upto=$([ -n "$hi" ] && echo "\"$hi\"" || echo null)
  pg -c "INSERT INTO core.outbox_events
          (aggregate_type, aggregate_id, event_type, destination, payload_json,
           status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                 '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"00000000-0000-4000-8000-000000000002\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":$after,\"untilUserId\":$upto,\"sliceLimit\":1000}'::jsonb,
                 'PENDING','probe:$material:$c',0,now(),now(),now());" > /dev/null
done <<< "$ranges"

t0="$(now_ms)"; prev=0; last_change=$(date +%s)
while :; do
  now=$(date +%s)
  cur="$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)"
  printf '\r   %4ss · %8s/%s   ' "$(( now - (t0 / 1000) ))" "$cur" "$USERS"
  [ "$cur" -eq "$prev" ] || last_change=$now
  prev=$cur
  [ "$cur" -ge "$USERS" ] && break
  [ $(( now - last_change )) -ge "$STALL_SECONDS" ] && { echo; echo "   정체 — 부분 결과"; break; }
  sleep 2
done
elapsed_ms=$(( $(now_ms) - t0 ))
echo

kill "$wait_pid" "$q_pid" "$c_pid" 2>/dev/null || true

echo "▶ 계측기 수거"

# 쿼터를 걸었으면 스로틀링이 걸렸는지 읽는다. CFS는 100ms 주기마다 예산을 끊으므로,
# 예산에 자주 닿았다면 처리량이 아니라 계단에 눌린 값을 본 것이다. 컨테이너를 세우기
# 전에 읽어야 한다.
printf 'container,nr_periods,nr_throttled,throttled_pct\n' > "$OUT/throttle.csv"
for c in $(compose ps --format '{{.Name}}' 2>/dev/null); do
  st="$(docker exec "$c" cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true)"
  [ -n "$st" ] || continue
  echo "$st" | awk -v n="${c#liveclass-bench-}" '
    /^nr_periods/{p=$2} /^nr_throttled/{t=$2}
    END{ if (p > 0) printf "%s,%d,%d,%.1f\n", n, p, t, 100*t/p }' >> "$OUT/throttle.csv"
done

pg -c "\copy (SELECT calls, total_exec_time, mean_exec_time, rows, query
              FROM pg_stat_statements
             WHERE query NOT LIKE '%pg_stat%' AND total_exec_time > 0
             ORDER BY total_exec_time DESC LIMIT 25) TO STDOUT WITH CSV HEADER" \
  > "$OUT/statements.csv" 2>/dev/null || echo "   pg_stat_statements 수거 실패" >&2

# JFR은 종료 시 덤프된다(dumponexit). 정상 종료를 기다렸다가 꺼낸다.
for s in "${services[@]}"; do
  compose stop -t 60 "$s" > /dev/null 2>&1 || true
  cid="$(compose ps -aq "$s" 2>/dev/null | head -1)"
  [ -n "$cid" ] && docker cp "$cid:/tmp/app.jfr" "$OUT/$s.jfr" 2>/dev/null || true
done

# JRE 런타임 이미지에는 jfr CLI가 없다. JDK 컨테이너에서 읽는다.
for f in "$OUT"/*.jfr; do
  [ -e "$f" ] || continue
  docker run --rm -v "$OUT:/x" eclipse-temurin:21-jdk \
    jfr print --json --events jdk.ExecutionSample "/x/$(basename "$f")" \
    > "$f.json" 2>/dev/null || true
done

python3 - "$OUT" "$elapsed_ms" "$PG_PHYS" "$APP_PHYS" "$t0" "$N" "$APP_CPUS_EACH" <<'PY'
import csv, datetime, glob, json, os, re, sys
out, ms, pg_phys, app_phys = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
t0_ms, chains, app_cpus = int(sys.argv[5]), int(sys.argv[6]), float(sys.argv[7])
t1_ms = t0_ms + ms
sec = ms / 1000
W = 74

def rule(t=""):
    print(("── %s " % t if t else "──").ljust(W, "─"))

print()
rule("병목 내역")
print("  벽시계  %.1f초    · pg 물리 %d코어 전용 · 앱 물리 %d코어 공유" % (sec, pg_phys, app_phys))

# 1. 대기 이벤트 분포 ------------------------------------------------------
raw = os.path.join(out, "waits.raw")
rounds, waits = [], {}
if os.path.exists(raw):
    for line in open(raw, errors="replace"):
        p = line.strip().split("|")
        if len(p) != 5 or not p[0].isdigit():
            continue
        rounds.append(tuple(int(x) for x in p[:4]))
        for w in p[4].split():
            waits[w] = waits.get(w, 0) + 1

print()
rule("1. 매 순간 Postgres에서 실제로 돌던 백엔드 수 (%d 판)" % len(rounds))
if rounds:
    n = len(rounds)
    cpu = sum(r[0] for r in rounds) / n
    wait = sum(r[1] for r in rounds) / n
    intx = sum(r[2] for r in rounds) / n
    idle = sum(r[3] for r in rounds) / n
    print("   실행 중(CPU)          평균 %.2f개" % cpu)
    print("   실행 중(대기)         평균 %.2f개   (IO·잠금·내부 경합)" % wait)
    print("   트랜잭션 열고 유휴    평균 %.2f개   ← 앱이 커밋 전에 딴 일 하는 중" % intx)
    print("   그냥 유휴(풀 여분)    평균 %.2f개" % idle)
    print()
    print("   동시 실행 %.2f개 / 체인 %d개 = %.0f%%" % (cpu + wait, chains, 100 * (cpu + wait) / chains))
    if cpu + wait < chains * 0.7:
        print("   체인 수만큼도 못 채운다 — DB에 일감이 안 들어오고 있다. 병목은 DB 밖이다.")
    if waits:
        print()
        print("   대기 내역 상위")
        tot_w = sum(waits.values())
        for k, v in sorted(waits.items(), key=lambda kv: -kv[1])[:6]:
            print("     %5.1f%%  %s" % (100 * v / tot_w, k))
else:
    print("   샘플 없음 — 대기 이벤트 샘플러가 붙지 못했다.")

# 2. 문장별 DB 시간 --------------------------------------------------------
print()
rule("2. DB 시간을 먹은 문장")
stm = os.path.join(out, "statements.csv")
db_ms = 0.0
if os.path.exists(stm) and os.path.getsize(stm) > 0:
    rows = list(csv.DictReader(open(stm)))
    db_ms = sum(float(r["total_exec_time"]) for r in rows)
    for r in rows[:8]:
        q = " ".join(r["query"].split())[:52]
        print("   %7.1f초 %6.2fms×%-7s %s" % (
            float(r["total_exec_time"]) / 1000, float(r["mean_exec_time"]), r["calls"], q))
    print()
    print("   DB 실행 시간 합계 %.1f초 / (벽시계 %.1f초 × %d코어 = %.1f초) = %.0f%% 점유" % (
        db_ms / 1000, sec, pg_phys, sec * pg_phys, 100 * (db_ms / 1000) / (sec * pg_phys)))
else:
    print("   수거 실패")

# 3. 큐 깊이 --------------------------------------------------------------
print()
rule("3. 큐 깊이")
qf = os.path.join(out, "queues.csv")
if os.path.exists(qf):
    rows = [r for r in csv.DictReader(open(qf)) if r.get("fanout", "").isdigit()]
    if rows:
        f = [int(r["fanout"]) for r in rows]
        p = [int(r["push"]) for r in rows]
        print("   팬아웃 큐  평균 %.1f · 최대 %d" % (sum(f) / len(f), max(f)))
        print("   푸시   큐  평균 %.1f · 최대 %d  (발송 꺼 둠 — 적재만)" % (sum(p) / len(p), max(p)))
        print()
        # 체인 하나는 언제나 메시지 하나를 물고 있다. 깊이가 체인 수 근처면 아무것도
        # 줄 서 있지 않은 것이고, 그때 한계는 소비자가 아니라 체인 수 자체다.
        if max(f) <= chains + 1:
            print("   깊이가 체인 수(%d)를 안 넘는다 — 줄 서는 게 없다. 소비자가 모자란 게" % chains)
            print("   아니라 일감이 체인 수만큼만 나온다. 상한은 직렬 체인 구조 자체다.")
        else:
            print("   큐가 쌓인다 — 소비자가 모자란다. 인스턴스를 늘리면 더 갈 수 있다.")

# 4. 컨테이너 CPU ---------------------------------------------------------
print()
rule("4. 컨테이너 CPU (100%% = 논리 1코어 · 앱 상한은 쿼터 %.2f CPU)" % app_cpus)
cf = os.path.join(out, "cpu.csv")
if os.path.exists(cf):
    agg = {}
    for r in csv.DictReader(open(cf)):
        if r.get("cpu_pct"):
            agg.setdefault(r["container"], []).append(float(r["cpu_pct"]))
    for name, vals in sorted(agg.items(), key=lambda kv: -sum(kv[1]) / len(kv[1])):
        avg = sum(vals) / len(vals)
        cap = (100 * app_cpus if "-app" in name
               else 200 * pg_phys if "postgres" in name else 200)
        print("   %-34s %6.0f%%   (상한 %d%%, %2.0f%% 사용)" % (
            name.replace("liveclass-bench-", ""), avg, cap, 100 * avg / cap))

    # 쿼터에 눌렸는지. 눌렸다면 위 수치는 실력이 아니라 예산이다.
    tf = os.path.join(out, "throttle.csv")
    if os.path.exists(tf):
        rows = [r for r in csv.DictReader(open(tf)) if float(r.get("throttled_pct", 0)) > 0]
        print()
        if rows:
            print("   CFS 스로틀링 — 예산에 닿아 멈춘 주기의 비율")
            for r in sorted(rows, key=lambda r: -float(r["throttled_pct"])):
                print("     %-22s %5.1f%%  (%s/%s 주기)"
                      % (r["container"], float(r["throttled_pct"]), r["nr_throttled"], r["nr_periods"]))
            print("   눌린 컨테이너의 CPU%는 실력이 아니라 예산이다.")
        else:
            print("   CFS 스로틀링 없음 — 쿼터가 결과를 누르지 않았다.")

# 5. 앱 CPU 내역 ----------------------------------------------------------
print()
rule("5. 앱 CPU가 간 곳 (JFR 실행 샘플)")
def ev_ms(v):
    """JFR 시각을 epoch ms로.

    JFR은 나노초 9자리를 쓰는데(2026-08-17T14:23:45.750841826Z) fromisoformat은
    소수점 이하 6자리까지만 받는다. 자르지 않으면 전부 파싱에 실패하고, 그러면
    시간 창 필터가 통째로 무력해져 부팅 프로파일이 그대로 남는다.
    """
    t = v.get("startTime")
    if t is None:
        return None
    if isinstance(t, (int, float)):
        return float(t) if t > 1e11 else float(t) * 1000
    try:
        s = re.sub(r"(\.\d{6})\d+", r"\1", str(t)).replace("Z", "+00:00")
        return datetime.datetime.fromisoformat(s).timestamp() * 1000
    except Exception:
        return None

frames, threads = {}, {}
n_samples = n_outside = n_undated = 0
for jf in glob.glob(os.path.join(out, "*.jfr.json")):
    try:
        doc = json.load(open(jf))
    except Exception:
        continue
    for ev in doc.get("recording", {}).get("events", []):
        vals = ev.get("values") or {}
        # 기록은 JVM 시작부터 돈다. 자르지 않으면 부팅(중첩 jar 클래스 로딩, Hibernate의
        # JPQL 파싱)이 프로파일을 다 먹는다 — 첫 판이 정확히 그랬다.
        ts = ev_ms(vals)
        if ts is None:
            n_undated += 1
        elif not (t0_ms <= ts <= t1_ms):
            n_outside += 1
            continue
        st = vals.get("stackTrace") or {}
        fr = st.get("frames") or []
        if not fr:
            continue
        n_samples += 1
        th = ((vals.get("sampledThread") or {}).get("javaName")) or "?"
        threads[th] = threads.get(th, 0) + 1
        # 위에서부터 내려오며 첫 애플리케이션·라이브러리 프레임을 대표로 잡는다.
        for f in fr[:12]:
            m = f.get("method") or {}
            t = m.get("type") or {}
            # jfr의 JSON은 판마다 키가 다르다(name / className). 둘 다 받는다.
            cls = t.get("name") or t.get("className") or ""
            if cls.startswith(("java.", "jdk.", "sun.")):
                continue
            key = "%s.%s" % (cls.split(".")[-1] if cls else "?", m.get("name") or "?")
            frames[key] = frames.get(key, 0) + 1
            break

if n_samples:
    print("   측정 구간 샘플 %d개 (구간 밖 %d개 버림%s)"
          % (n_samples, n_outside, "" if not n_undated else " · 시각 없음 %d개 포함" % n_undated))
    print()
    print("   스레드별")
    for k, v in sorted(threads.items(), key=lambda kv: -kv[1])[:8]:
        print("     %5.1f%%  %s" % (100 * v / n_samples, k))
    print()
    print("   메서드별")
    for k, v in sorted(frames.items(), key=lambda kv: -kv[1])[:12]:
        print("     %5.1f%%  %s" % (100 * v / n_samples, k))
else:
    print("   JFR 없음 — 앱이 정상 종료하지 못했거나 jfr 파싱이 실패했다.")

print()
rule()
PY

echo
echo "결과: $OUT"
