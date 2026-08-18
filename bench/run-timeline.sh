#!/usr/bin/env bash
#
# 팬아웃과 발송이 **얼마나 겹치는지** 잰다. 그리고 구간마다 코어를 맞춰 주면 얼마나 달라지는지.
#
# 왜 겹침이 중요한가. 팬아웃은 조각마다 푸시 명령을 큐에 넣으므로 발송은 팬아웃이 끝나기를
# 기다리지 않는다 — 첫 조각이 커밋되는 순간부터 보내기 시작한다. 그래서 전 구간 시간은
# "팬아웃 + 발송"이 아니라 "발송 시작 지연 + 발송"에 가깝다.
#
# 그 차이가 1분 예산에서 결론을 바꾼다.
#
#   겹치지 않는다고 보면   발송에 40초  →  필요 코어 20.7
#   겹친다고 보면          발송에 59초  →  필요 코어 14.0
#
# 그래서 짐작하지 않고 잰다. 목 서버가 첫 발송·마지막 발송 시각을 갖고 있고, 여기서는
# 0.5초마다 (시각, 알림 행 수, 발송 건수)를 기록해 타임라인을 통째로 남긴다.
#
# 모드
#   shared  앱 하나가 물리 1코어에서 팬아웃과 발송을 다 한다(지금 운영 형태).
#           겹침이 실제로 얼마나 되는지, 그리고 서로 코어를 훔치는 값이 여기서 나온다.
#   split   구간마다 코어를 맞춘다. 팬아웃은 DB에, 발송은 앱에 몰아준다.
#           별도 머신으로 나눴을 때의 각 구간 실력이 이 값이다.
#
# 사용법: MODE=shared bench/run-timeline.sh
#         MODE=split  bench/run-timeline.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO_ROOT/bench"
MODE="${MODE:-shared}"
CHAINS="${CHAINS:-2}"
SLICE="${SLICE:-5000}"
FANOUT_CONC="${FANOUT_CONC:-8}"
PUSH_CONC="${PUSH_CONC:-2}"
# 목 서버의 응답 지연. 순진한 구조와 지금 구조를 같은 조건에서 비교하려면 이 값이 둘 다 같아야
# 한다. 이 프로젝트가 따로 재 둔 FCM 왕복이 230ms다(application.yml notification.web-push).
MOCK_DELAY="${MOCK_DELAY:-230ms}"
OUT="${OUT:-$BENCH/results/timeline-$MODE-$(date +%Y%m%dT%H%M%S)}"

fail() { echo "실패: $*" >&2; exit 1; }
mkdir -p "$OUT"
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now().astimezone().isoformat())'; }
new_uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
compose() { docker compose -f "$BENCH/compose.bench.yml" "$@"; }
pg() { compose exec -T -e PGPASSWORD=bench postgres psql -U liveclass -d liveclass -qtA "$@" < /dev/null; }
mock() { curl -s --max-time 5 "http://127.0.0.1:18080$1"; }
push_queue_depth() {
  compose exec -T rabbitmq rabbitmqctl list_queues -q name messages < /dev/null 2>/dev/null \
    | awk '$1=="notification.push"{print $2}'
}

# 구간별 배분. 팬아웃은 DB가, 발송은 앱이 병목이라 같은 배분으로 둘 다 재면 어느 쪽도 제 실력이 아니다.
#   팬아웃  pg 2코어 · 앱 1코어 · 인프라 1코어
#   발송    앱 2코어 · pg 1코어 · 인프라 1코어   (발송은 DB를 21%밖에 안 쓴다)
PG_FANOUT="0,4,1,5"; APP_FANOUT="2,6";     INFRA_FANOUT="3,7"
PG_PUSH="0,4";       APP_PUSH="2,6,3,7";   INFRA_PUSH="1,5"

start_infra() {
  PG_CPUSET="$1" INFRA_CPUSET="$2" MOCK_DELAY="$MOCK_DELAY" \
    compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
    || fail "인프라 기동 실패"
  PG_CPUSET="$1" INFRA_CPUSET="$2" \
    compose --profile mon up -d --wait --wait-timeout 300 postgres-exporter cadvisor > /dev/null 2>&1 || true
}

# 도는 컨테이너의 cpuset을 **제자리에서** 바꾼다. compose로 바꾸면 컨테이너가 다시 만들어지고,
# 그러면 구간 A가 큐에 쌓아 둔 푸시 명령을 잃는다(호스트명이 바뀌어 RabbitMQ가 빈 노드로 뜬다).
# compose에는 항상 구간 A 값을 넘겨 설정 차이를 만들지 않는다 — 실제 배정은 여기서만 바꾼다.
set_cpuset() {  # $1 pg $2 infra
  local id
  for svc in postgres; do
    id="$(compose ps -q "$svc")" && [ -n "$id" ] && docker update --cpuset-cpus "$1" "$id" > /dev/null
  done
  for svc in redis rabbitmq mock-push; do
    id="$(compose ps -q "$svc")" && [ -n "$id" ] && docker update --cpuset-cpus "$2" "$id" > /dev/null
  done
  echo "   인프라 cpuset 제자리 변경 pg[$1] 인프라[$2]"
}

start_app() {  # $1 pg $2 infra $3 app $4 fanout_on $5 push_on
  compose rm -sf app > /dev/null 2>&1 || true
  PG_CPUSET="$1" INFRA_CPUSET="$2" APP_CPUSET="$3" MOCK_DELAY="$MOCK_DELAY" \
  APP_HEAP="${APP_HEAP:-1g}" APP_MEM="${APP_MEM:-1600m}" \
  FANOUT_ENABLED="$4" PUSH_ENABLED="$5" \
  FANOUT_CONCURRENCY="$FANOUT_CONC" PUSH_CONCURRENCY="$PUSH_CONC" \
    compose up -d --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"
}

reset_state() {
  pg -c "TRUNCATE core.notification, core.notification_dedupe, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true
  mock /reset > /dev/null 2>&1 || true
}

trigger() {
  local material ranges c after upto lo hi
  material="$(new_uuid)"
  ranges="$(python3 -c "
import sys
n = int(sys.argv[1]); span = 1 << 128
def u(v):
    h = '%032x' % (v - 1)
    return '%s-%s-%s-%s-%s' % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
for i in range(n):
    print('%s|%s' % ('' if i == 0 else u(i * span // n),
                     '' if i == n - 1 else u((i + 1) * span // n)))
" "$CHAINS")"
  c=0
  while IFS='|' read -r lo hi; do
    c=$(( c + 1 ))
    after=$([ -n "$lo" ] && echo "\"$lo\"" || echo null)
    upto=$([ -n "$hi" ] && echo "\"$hi\"" || echo null)
    pg -c "INSERT INTO core.outbox_events
            (aggregate_type, aggregate_id, event_type, destination, payload_json,
             status, idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
           VALUES ('material','$material','NOTIFICATION_FANOUT_REQUESTED','notification.fanout',
                   '{\"type\":\"MATERIAL_PUBLISHED\",\"curriculumId\":\"00000000-0000-4000-8000-000000000002\",\"curriculumTitle\":\"벤치\",\"lessonId\":\"00000000-0000-4000-8000-000000000004\",\"materialId\":\"$material\",\"subjectName\":\"x.pptx\",\"occurredAt\":\"$(iso_now)\",\"afterUserId\":$after,\"untilUserId\":$upto,\"sliceLimit\":$SLICE}'::jsonb,
                   'PENDING','tl:$material:$c',0,now(),now(),now());" > /dev/null
  done <<< "$ranges"
}

# 진행만 본다. **폴링을 촘촘히 하지 않는다** — 0.5초마다 docker compose exec를 두 번씩 부르면
# 그 자체가 측정에 얹힌다(팬아웃이 18.8초에서 22.3초로 늘었다). 정확한 시각은 폴링이 아니라
# 이미 기록된 곳에서 가져온다.
#
#   팬아웃 완료   SELECT max(created_at) FROM core.notification   행에 박힌 시각
#   첫·마지막 발송  목 서버의 firstAtUnixMs · lastAtUnixMs
#
# 그래서 여기서는 "끝났는지"만 2초마다 확인하면 되고, 그 간격이 결과의 정밀도를 좌우하지 않는다.
sample_until() {  # $1 목표알림 $2 목표발송(0이면 무시) $3 로그파일
    local want_n="$1" want_p="$2" f="$3" n p last=0 idle=0
    printf 'ms,notifications,pushes\n' > "$f"
    while :; do
      n="$(pg -c 'SELECT count(*) FROM core.notification;' 2>/dev/null || echo 0)"
      p="$(mock /stats 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("total",0))' 2>/dev/null || echo 0)"
      echo "$(now_ms),$n,$p" >> "$f"
      printf '\r   알림 %8s/%s · 발송 %8s   ' "$n" "$want_n" "$p"
      if [ "$n" -ge "$want_n" ] && { [ "$want_p" -eq 0 ] || [ "$p" -ge "$want_p" ]; }; then break; fi
      if [ "$(( n + p ))" -eq "$last" ]; then idle=$(( idle + 1 )); else idle=0; fi
      last=$(( n + p ))
      [ "$idle" -ge 60 ] && { echo; echo "   정체"; break; }
      sleep 2
    done
    echo
}

# 알림 행에 박힌 시각. 폴링 간격과 무관하게 정확하다.
fanout_bounds_ms() {
  pg -c "SELECT (extract(epoch from min(created_at))*1000)::bigint || ' ' ||
                (extract(epoch from max(created_at))*1000)::bigint
         FROM core.notification;" 2>/dev/null || echo "0 0"
}

echo "▶ 모드 $MODE · 갈래 $CHAINS · 조각 $SLICE · 공급자 지연 $MOCK_DELAY"
USERS_Q="SELECT count(*) FROM core.enrollment WHERE curriculum_id='00000000-0000-4000-8000-000000000002' AND status='ACTIVE';"

if [ "$MODE" = "shared" ]; then
  start_infra "$PG_FANOUT" "$INFRA_FANOUT"
  USERS="$(pg -c "$USERS_Q")"; SUBS="$(pg -c 'SELECT count(*) FROM core.push_subscription;')"
  echo "   수강생 $USERS · 구독 $SUBS · 배분 pg[$PG_FANOUT] 앱[$APP_FANOUT] 인프라[$INFRA_FANOUT]"
  reset_state
  start_app "$PG_FANOUT" "$INFRA_FANOUT" "$APP_FANOUT" true true
  sleep 8
  T0="$(now_ms)"; trigger
  sample_until "$USERS" "$SUBS" "$OUT/samples.csv"
  T_END="$(now_ms)"
  read -r FAN_MIN FAN_MAX <<< "$(fanout_bounds_ms)"
else
  # ── 구간 A: 팬아웃만, DB에 코어를 몰아준다 ──
  start_infra "$PG_FANOUT" "$INFRA_FANOUT"
  USERS="$(pg -c "$USERS_Q")"; SUBS="$(pg -c 'SELECT count(*) FROM core.push_subscription;')"
  echo "   수강생 $USERS · 구독 $SUBS"
  echo "   구간 A 배분 pg[$PG_FANOUT] 앱[$APP_FANOUT] 인프라[$INFRA_FANOUT]"
  reset_state
  start_app "$PG_FANOUT" "$INFRA_FANOUT" "$APP_FANOUT" true false
  sleep 8
  T0="$(now_ms)"; trigger
  sample_until "$USERS" 0 "$OUT/samples-fanout.csv"
  read -r FAN_MIN FAN_MAX <<< "$(fanout_bounds_ms)"
  T_FANOUT_END="$FAN_MAX"
  echo "   구간 A 종료 시점 푸시 큐 $(push_queue_depth)건"
  echo "   팬아웃 $(python3 -c "print(($T_FANOUT_END-$T0)/1000)")초 (마지막 행에 박힌 시각 기준)"

  # ── 구간 B: 발송만, 앱에 코어를 몰아준다 ──
  echo "   구간 B 배분 pg[$PG_PUSH] 앱[$APP_PUSH] 인프라[$INFRA_PUSH]"
  set_cpuset "$PG_PUSH" "$INFRA_PUSH"
  mock /reset > /dev/null 2>&1 || true
  pg -c "TRUNCATE core.notification_push_progress;" > /dev/null
  QD="$(push_queue_depth)"
  [ "${QD:-0}" -gt 0 ] || fail "푸시 큐가 비었다(${QD:-없음}). 구간 A가 쌓은 명령이 사라졌다."
  echo "   푸시 큐 $QD건 대기 중"
  start_app "$PG_FANOUT" "$INFRA_FANOUT" "$APP_PUSH" false true
  T_PUSH_START="$(now_ms)"
  sample_until 0 "$SUBS" "$OUT/samples-push.csv"
  T_END="$(now_ms)"
fi

MOCK_STATS="$(mock /stats 2>/dev/null || echo '{}')"
echo "$MOCK_STATS" > "$OUT/mock.json"

python3 - "$OUT" "$MODE" "${T0:-0}" "${T_END:-0}" "${T_FANOUT_END:-0}" "${T_PUSH_START:-0}" "${FAN_MAX:-0}" <<'PY'
import csv, json, os, sys
out, mode = sys.argv[1], sys.argv[2]
t0, t_end, t_fan, t_push0, fan_max = (int(x) for x in sys.argv[3:8])
mock = json.load(open(os.path.join(out, "mock.json")))
S = lambda ms: ms / 1000.0

print()
print("════ 타임라인 (%s) ════" % mode)

if mode == "shared":
    rows = list(csv.DictReader(open(os.path.join(out, "samples.csv"))))
    ts = [(int(r["ms"]), int(r["notifications"]), int(r["pushes"])) for r in rows]
    # 폴링이 아니라 마지막 알림 행에 박힌 시각. 2초 간격과 무관하게 정확하다.
    fan_done = fan_max or next((m for m, n, _ in ts if n >= max(n for _, n, _ in ts)), t_end)
    first_push = mock.get("firstAtUnixMs") or next((m for m, _, p in ts if p > 0), 0)
    last_push = mock.get("lastAtUnixMs") or t_end

    lag = S(first_push - t0)
    fan = S(fan_done - t0)
    total = S(last_push - t0)
    overlap = S(fan_done - first_push)

    print("   사건 → 첫 발송        %7.2f초   (발송이 팬아웃을 기다리지 않는다)" % lag)
    print("   사건 → 팬아웃 완료    %7.2f초" % fan)
    print("   사건 → 마지막 발송    %7.2f초" % total)
    print()
    print("   겹친 구간             %7.2f초   팬아웃과 발송이 동시에 돈 시간" % overlap)
    print("   겹침 비율             %7.1f%%   팬아웃 시간 중" % (100 * overlap / fan if fan else 0))
    summary = {"mode": mode, "lag_s": lag, "fanout_s": fan, "total_s": total, "overlap_s": overlap}
else:
    fan = S(t_fan - t0)
    push = S(t_end - t_push0)
    print("   팬아웃 (pg에 코어)     %7.2f초" % fan)
    print("   발송   (앱에 코어)     %7.2f초   = %.1f분" % (push, push / 60))
    print()
    print("   순차 합               %7.2f초" % (fan + push))
    summary = {"mode": mode, "fanout_s": fan, "push_s": push, "sequential_s": fan + push}

summary["mock"] = {k: mock.get(k) for k in ("total", "delivered", "tooMany", "serverError", "gone")}
json.dump(summary, open(os.path.join(out, "summary.json"), "w"), indent=2)
print()
print("   목 수신 %s · 성공 %s · 429 %s · 5xx %s"
      % (mock.get("total"), mock.get("delivered"), mock.get("tooMany"), mock.get("serverError")))
PY

echo
echo "결과: $OUT"
