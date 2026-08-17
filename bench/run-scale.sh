#!/usr/bin/env bash
#
# 워커 인스턴스를 늘려 가며 구간별 처리량을 잰다 — 선형인가, 어디서 꺾이나.
#
# **왜 인스턴스인가.** 팬아웃도 발송도 competing consumer라 프로세스를 나누면 수평
# 확장이 된다. 한 프로세스 안에서 스레드만 늘리는 것과 다르다 — 실제 배치는 워커를
# 별도 노드로 두는 것이고, 그때 무엇이 먼저 막히는지(공유 자원인 DB·브로커)가 답이다.
#
# 구간마다 따로 잰다. 팬아웃과 발송을 동시에 돌리면 서로 코어를 훔쳐 어느 쪽 수치도
# 그 구간의 실력이 아니다(실측: 동시 실행 시 발송 1,636건/s → 분리 시 8,834건/s).
#
#   PHASE=A  팬아웃만 — 알림 행 생성 + 큐 적재
#   PHASE=B  발송만   — 쌓인 큐 비우기
#
# **한 번에 한 변수만 움직인다.** LAYOUT=shared(기본)는 Postgres 3코어를 고정한 채
# 앱 인스턴스 전체가 물리 1코어를 공유한다 — 인스턴스를 늘려도 앱 몫의 CPU는 그대로고
# 늘어나는 건 DB 커넥션과 소비자 수뿐이다. LAYOUT=dedicated는 인스턴스마다 물리 1코어를
# 주는 대신 pg 코어를 뺏으므로, 앱이 CPU 바운드인 구간에서만 쓴다(plan_for 주석 참조).
#
# 힙은 한 비교 안에서 고정한다 — 인스턴스를 늘리면 한 대당 힙을 줄여야 7GB에
# 들어가므로 1대 기준선도 같은 힙으로 재야 한다.
#
# 사용법
#   bench/run-scale.sh A                      # 팬아웃 1→2→3 인스턴스 (앱 1코어 공유)
#   bench/run-scale.sh B                      # 발송 1→2→3 인스턴스 (큐가 차 있어야 한다)
#   LAYOUT=dedicated bench/run-scale.sh B     # 발송은 앱마다 코어를 줘 볼 만하다
#   INSTANCES="1 2" bench/run-scale.sh A
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
PHASE="${1:-A}"
INSTANCES="${INSTANCES:-1 2 3}"
OUT="${OUT:-$BENCH/results/scale-$PHASE-${LAYOUT:-shared}-$(date +%Y%m%dT%H%M%S)}"

LAYOUT="${LAYOUT:-shared}"
APP_HEAP="${APP_HEAP:-1g}"
APP_MEM="${APP_MEM:-1600m}"
STALL_SECONDS="${STALL_SECONDS:-120}"

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

# < /dev/null 이 없으면 docker compose exec가 while read 루프의 stdin을 먹는다.
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
mock() { curl -s --max-time 5 "http://127.0.0.1:18080$1"; }
qdepth() { compose exec -T rabbitmq rabbitmqctl list_queues -q name messages 2>/dev/null < /dev/null \
             | awk -v q="$1" '$1==q{print $2}'; }

[ "$PHASE" = "A" ] || [ "$PHASE" = "B" ] || fail "PHASE는 A 또는 B"

# 체인 수만큼 팬아웃 명령을 넣는다. 소비자가 n개인데 체인이 1개면 n-1대가 논다.
trigger_fanout() {
  local n="$1" material ranges c after upto lo hi
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
" "$n")"
  c=0
  while IFS='|' read -r lo hi; do
    c=$(( c + 1 ))
    after=$([ -n "$lo" ] && echo "\"$lo\"" || echo null)
    upto=$([ -n "$hi" ] && echo "\"$hi\"" || echo null)
    pg -c "INSERT INTO core.outbox_events
            (aggregate_type, aggregate_id, event_type, destination, payload_json,
             status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
           VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                   '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"00000000-0000-4000-8000-000000000002\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":$after,\"untilUserId\":$upto,\"sliceLimit\":${SLICE_LIMIT:-5000}}'::jsonb,
                   'PENDING','bench:$material:$c',0,now(),now(),now());" > /dev/null
  done <<< "$ranges"
}


if [ "${SKIP_ISOLATION:-0}" != "1" ]; then
  others="$(docker ps --format '{{.Names}}' | grep -v '^liveclass-bench' || true)"
  [ -z "$others" ] || fail "벤치 외 컨테이너: $(echo "$others" | paste -sd, -)"
  [ $(( $(awk '/^SwapTotal:/{print $2}' /proc/meminfo) - $(awk '/^SwapFree:/{print $2}' /proc/meminfo) )) -eq 0 ] \
    || fail "스왑 사용 중."
fi

# 인스턴스 수 → (프로파일, pg cpuset, 앱별 cpuset)
#
# LAYOUT=shared (기본) — 앱 전체가 물리 1코어를 공유하고 Postgres는 3코어 고정.
#   인스턴스를 늘려도 앱 몫의 CPU는 그대로다. 늘어나는 건 DB 커넥션과 소비자 수뿐이고,
#   팬아웃에서 늘려야 하는 게 정확히 그것이다 — 워커는 SQL 한 문장을 던지고 23.8ms를
#   기다릴 뿐, 인덱스 스캔·md5 100만·삽입 3벌·WAL은 전부 Postgres 안에서 돈다.
#
# LAYOUT=dedicated — 인스턴스마다 물리 1코어를 주고 pg는 남는 코어를 쓴다.
#   첫 측정이 이 배분이었고, 인스턴스 수와 pg 코어 수가 같이 움직여 결과를 가를 수
#   없었다(1대 pg 3코어 18,051/s · 2대 pg 2코어 22,884/s · 3대 pg 1코어 13,717/s —
#   3대가 느린 게 워커 때문인지 pg 코어가 1개로 줄어서인지 이 표로는 모른다).
#   앱이 CPU 바운드인 구간(발송)에서만 의미가 있다.
plan_for() {
  local P I
  if [ "$LAYOUT" = "shared" ]; then
    P="0,4,1,5"; I="3,7"          # pg 2코어 전용 · 브로커 1코어 전용
    case "$1" in
      1) echo "none|$P|$I|2,6" ;;
      2) echo "scale2|$P|$I|2,6|2,6" ;;
      3) echo "scale3|$P|$I|2,6|2,6|2,6" ;;
      *) fail "지원하지 않는 인스턴스 수: $1" ;;
    esac
  elif [ "$LAYOUT" = "balanced" ]; then
    P="0,4"; I="1,5"              # 앱에 2코어를 주는 대신 pg·브로커가 1코어씩
    case "$1" in
      1) echo "none|$P|$I|2,6,3,7" ;;
      2) echo "scale2|$P|$I|2,6,3,7|2,6,3,7" ;;
      3) echo "scale3|$P|$I|2,6,3,7|2,6,3,7|2,6,3,7" ;;
      *) fail "지원하지 않는 인스턴스 수: $1" ;;
    esac
  else
    P="0,4"; I="1,5"
    case "$1" in
      1) echo "none|$P|$I|2,6" ;;
      2) echo "scale2|$P|$I|2,6|3,7" ;;
      3) echo "scale3|$P|$I|2,6|3,7|1,5" ;;
      *) fail "지원하지 않는 인스턴스 수: $1" ;;
    esac
  fi
}

echo "▶ 인프라 기동"
compose up -d --build --wait --wait-timeout 600 postgres redis rabbitmq mock-push 2>&1 | tail -1
SUBS="$(pg -c 'SELECT count(*) FROM core.push_subscription;')"
USERS="$(pg -c "SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';")"
[ "${SUBS:-0}" -gt 0 ] || fail "시드가 없다."
echo "   수강생 $USERS · 구독 $SUBS · 힙 $APP_HEAP/인스턴스"

printf 'instances,elapsed_s,throughput_per_s,per_instance,vs_one,app_cpu_pct,pg_cpu_pct\n' > "$OUT/summary.csv"
BASE=""

for n in $INSTANCES; do
  IFS='|' read -r profile pgset infraset a1 a2 a3 <<< "$(plan_for "$n")"
  echo
  if [ "$LAYOUT" = "shared" ]; then
    echo "════ $PHASE · 인스턴스 ${n}개 (앱 $a1 공유 · pg $pgset · 브로커 $infraset) ════"
  else
    echo "════ $PHASE · 인스턴스 ${n}개 (앱 물리 ${n}코어 · pg $pgset · 브로커 $infraset) ════"
  fi

  compose down > /dev/null 2>&1 || true

  if [ "$PHASE" = "A" ]; then
    pg_up() { PG_CPUSET="$pgset" INFRA_CPUSET="$infraset" compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push; }
    pg_up > /dev/null 2>&1
    pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
                  core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
    pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
    pg -c "CHECKPOINT;" > /dev/null
    compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
    compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true
    mock /reset > /dev/null || true
    FAN=true; PUSHON=false; TARGET="$USERS"
  else
    # **회차마다 큐를 다시 채운다.** 발송 측정은 큐를 비우는 것이 곧 측정이라, 첫 회차가
    # 100만 건을 소비하고 나면 다음 회차에 잴 것이 없다. 그래서 회차 앞머리에서 팬아웃을
    # 한 번 돌려 큐를 채우고(발송은 꺼 둔 채), 그다음에 앱만 발송 모드로 다시 세운다.
    # 채우는 구간은 측정 밖이다 — 시계는 발송 모드로 바꾼 뒤에 시작한다.
    PG_CPUSET="$pgset" INFRA_CPUSET="$infraset" compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1
    pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
                  core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
    pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
    pg -c "CHECKPOINT;" > /dev/null
    compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
    compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true

    echo "   큐 채우는 중 (팬아웃 — 측정 밖)"
    prime_args=(up -d --build --wait --wait-timeout 300 app)
    [ "$n" -ge 2 ] && prime_args+=(app2); [ "$n" -ge 3 ] && prime_args+=(app3)
    [ "$profile" = "none" ] || prime_args=(--profile "$profile" "${prime_args[@]}")
    PG_CPUSET="$pgset" INFRA_CPUSET="$infraset" \
    APP_CPUSET="$a1" APP2_CPUSET="${a2:-3,7}" APP3_CPUSET="${a3:-1,5}" \
    APP_HEAP="$APP_HEAP" APP_MEM="$APP_MEM" FANOUT_ENABLED=true PUSH_ENABLED=false \
      compose "${prime_args[@]}" > /dev/null 2>&1 || fail "큐 채우기용 앱 기동 실패"
    trigger_fanout "$n"
    until [ "$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)" -ge "$USERS" ]; do
      sleep 3
    done
    # 아웃박스 릴레이가 마지막 푸시 명령까지 발행하도록 기다린다.
    while [ "$(pg -c "SELECT count(*) FROM core.outbox_events WHERE destination='notification.push' AND status='PENDING';")" -gt 0 ]; do
      sleep 2
    done
    echo "   채움 완료 — 푸시 큐 $(qdepth notification.push)건"

    # 앱을 발송 모드로 다시 세운다. 컨테이너를 지우고 올려야 환경변수가 바뀐다.
    compose rm -sf app app2 app3 > /dev/null 2>&1 || true
    mock /reset > /dev/null || true
    pg -c "TRUNCATE core.notification_push_progress;" > /dev/null
    # 소비자가 미리 쥐는 양을 1로 낮춘다. 명령 하나가 수천 건 발송이라 기본 250이면
    # 먼저 붙은 인스턴스가 전부 가져가 다른 인스턴스가 논다 — 확장 측정이 성립하지 않는다.
    PREFETCH_V=1
    FAN=false; PUSHON=true; TARGET="$SUBS"
  fi

  args=(up -d --build --wait --wait-timeout 300 app)
  [ "$n" -ge 2 ] && args+=(app2); [ "$n" -ge 3 ] && args+=(app3)
  [ "$profile" = "none" ] || args=(--profile "$profile" "${args[@]}")

  PG_CPUSET="$pgset" INFRA_CPUSET="$infraset" \
  APP_CPUSET="$a1" APP2_CPUSET="${a2:-3,7}" APP3_CPUSET="${a3:-1,5}" \
  APP_HEAP="$APP_HEAP" APP_MEM="$APP_MEM" \
  FANOUT_ENABLED="$FAN" PUSH_ENABLED="$PUSHON" PREFETCH="${PREFETCH_V:-250}" \
    compose "${args[@]}" > /dev/null 2>&1 || fail "앱 기동 실패 (인스턴스 $n)"
  svc=(app); [ "$n" -ge 2 ] && svc+=(app2); [ "$n" -ge 3 ] && svc+=(app3)
  assert_same_image "${svc[@]}" > /dev/null

  if [ "$PHASE" = "A" ]; then
    trigger_fanout "$n"
  fi

  # CPU 점유율을 같이 남긴다. "워커는 DB를 기다릴 뿐"이라는 주장은 워커 CPU%가
  # 배정된 코어를 다 못 쓴다는 사실로만 증명된다. set +e — 샘플러가 죽어도 측정은 간다.
  cpu_csv="$OUT/cpu-$n.csv"
  printf 'ts,container,cpu_pct\n' > "$cpu_csv"
  ( set +e +o pipefail
    while :; do
      docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null \
        | awk -v t="$(date +%s)" '{gsub(/%/,"",$2); print t "," $1 "," $2}' >> "$cpu_csv"
      sleep 2
    done ) &
  cpu_pid=$!
  trap 'kill "$cpu_pid" 2>/dev/null || true' EXIT

  t0="$(now_ms)"; prev=0; prev_at=$(date +%s); last_change=$(date +%s)
  while :; do
    now=$(date +%s)
    if [ "$PHASE" = "A" ]; then
      cur="$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)"
      qf="$(qdepth notification.fanout)"
      finished=$([ "$cur" -ge "$TARGET" ] && [ "${qf:-0}" -eq 0 ] && echo 1 || echo 0)
    else
      cur="$(mock /stats | python3 -c 'import sys,json;print(json.load(sys.stdin).get("total",0))' 2>/dev/null || echo 0)"
      finished=$([ "$cur" -ge "$TARGET" ] && echo 1 || echo 0)
    fi
    gap=$(( now - prev_at )); [ "$gap" -gt 0 ] || gap=1
    printf '\r   %4ss · %8s/%s · %6s/s   ' "$(( now - (t0 / 1000) ))" "$cur" "$TARGET" "$(( (cur - prev) / gap ))"
    [ "$cur" -eq "$prev" ] || last_change=$now
    prev=$cur; prev_at=$now
    [ "$finished" -eq 1 ] && break
    [ $(( now - last_change )) -ge "$STALL_SECONDS" ] && { echo; echo "   정체 — 부분 결과"; break; }
    sleep 3
  done
  elapsed_ms=$(( $(now_ms) - t0 ))
  kill "$cpu_pid" 2>/dev/null || true
  echo

  python3 - "$OUT/summary.csv" "$n" "$elapsed_ms" "$TARGET" "$BASE" "$cpu_csv" <<'PY'
import csv, sys
path, n, ms, target, base, cpu = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], sys.argv[6]
sec = ms / 1000
tp = target / sec
vs = tp / float(base) if base else 1.0

# 컨테이너별 평균 CPU%. docker stats의 100%는 논리 코어 1개다 — 물리 1코어(형제 쌍)를
# 다 쓰면 200%가 상한이다. 앱 합계가 상한에 한참 못 미치면 CPU를 기다리는 게 아니다.
app = db = 0.0
try:
    rows = [r for r in csv.DictReader(open(cpu)) if r.get("cpu_pct")]
    def avg(pred):
        v = {}
        for r in rows:
            if pred(r["container"]):
                v.setdefault(r["container"], []).append(float(r["cpu_pct"]))
        return sum(sum(x) / len(x) for x in v.values())
    app = avg(lambda c: "-app" in c)
    db = avg(lambda c: "postgres" in c)
except Exception:
    pass

with open(path, "a") as f:
    f.write("%d,%.1f,%.0f,%.0f,%.2f,%.0f,%.0f\n" % (n, sec, tp, tp / n, vs, app, db))
print("   %d대 → %.1f초 · %d건/s · 대당 %d건/s · 1대대비 %.2fx · 앱CPU %.0f%% · pgCPU %.0f%%"
      % (n, sec, tp, tp / n, vs, app, db))
PY
  [ -n "$BASE" ] || BASE="$(python3 -c "print($TARGET / ($elapsed_ms/1000))")"
done

echo
echo "════ $PHASE 확장성 ════"
column -s, -t "$OUT/summary.csv"
echo
echo "결과: $OUT"
