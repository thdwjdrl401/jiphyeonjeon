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
# 팬아웃 소비자는 체인 수 x 2가 기준이다(ADR-0134). 예전 기본값 8은 그 기준이 서기 전 값이다.
FANOUT_CONC="${FANOUT_CONC:-$(( CHAINS * 2 ))}"
PUSH_CONC="${PUSH_CONC:-2}"
# 구간 B를 발송 노드 몇 대로 돌릴 것인가. 2 이상이면 **같은 총 코어를 나눠** 준다 —
# 1대에 물리 2코어와 2대에 물리 1코어씩은 코어 예산이 같으므로, 차이가 나면 그것은
# 코어가 아니라 큐가 일을 나누는 방식에서 온 것이다(ADR-0136).
# 구간 B의 노드를 **발송 전용으로** 띄울 것인가. ADR-0127의 역할 표는 알림 리스너 말고도
# 스케줄링과 자막·강의노트 consumer를 끄라고 적어 두는데, 벤치는 그것을 적용한 적이 없다.
# 기본은 꺼짐 — 지금까지 잰 값과 비교할 수 있게 두고, 켜서 그 차이를 잰다.
PUSH_ROLE_ONLY="${PUSH_ROLE_ONLY:-false}"
PUSH_NODES="${PUSH_NODES:-1}"
PUSH_NODE_CPUSETS="${PUSH_NODE_CPUSETS:-2,6|3,7|1,5}"
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

# **이미지를 한 번 빌드한다.** 이 스크립트에는 --build이 한 군데도 없었다. 그래서 코드를 고쳐도
# 앞서 누군가 빌드해 둔 이미지로 쟀고, 새로 만든 프로퍼티는 앱에 아예 없었다 —
# 컨테이너 환경변수에는 값이 보이는데 그 값을 읽는 코드가 없어서 전역 기본값이 걸렸다.
build_app() {
  echo "▶ 앱 이미지 빌드"
  compose build app > /dev/null 2>&1 || fail "앱 이미지 빌드 실패"
}

start_infra() {
  PG_CPUSET="$1" INFRA_CPUSET="$2" MOCK_DELAY="$MOCK_DELAY" \
    compose up -d --wait --wait-timeout 300 postgres redis rabbitmq mock-push > /dev/null 2>&1 \
    || fail "인프라 기동 실패"
  # **cpuset을 여기서 다시 박는다.** 구간 B가 docker update로 제자리에서 바꿔 놓은 배정을 compose는
  # 모른다 — 설정 차이가 없으니 컨테이너를 다시 만들지 않고 그대로 둔다. 그래서 앞 회차가 남긴
  # 발송 배정(pg 1코어)으로 다음 회차의 구간 A가 돌아간 적이 있다. 팬아웃이 15.00초 대신 21.35초로
  # 나왔고, 그 회차만 조건이 달랐다는 것이 나중에 드러났다.
  set_cpuset "$1" "$2"
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
  echo "   인프라 cpuset pg[$(docker inspect "$(compose ps -q postgres)" --format '{{.HostConfig.CpusetCpus}}' 2>/dev/null)]" \
       "브로커[$(docker inspect "$(compose ps -q rabbitmq)" --format '{{.HostConfig.CpusetCpus}}' 2>/dev/null)]"
}

start_app() {  # $1 pg $2 infra $3 app $4 fanout_on $5 push_on
  # **app2·app3까지 지운다.** 앞 회차가 노드를 여러 대 띄웠으면 그것들이 그대로 살아남아
  # 같은 큐를 계속 소비한다. 1대로 재는 회차에 소비자가 넷 붙어 있는 것을 실제로 봤다 —
  # 둘은 prefetch 1, 둘은 앞 회차가 남긴 250이었다.
  compose rm -sf app app2 app3 > /dev/null 2>&1 || true
  local role_off=true
  # 팬아웃 구간에는 역할 스위치를 건드리지 않는다 — 여기서 보려는 것은 발송 노드다.
  [ "$4" = "true" ] && role_off=false
  [ "$PUSH_ROLE_ONLY" = "true" ] || role_off=false
  PG_CPUSET="$1" INFRA_CPUSET="$2" APP_CPUSET="$3" MOCK_DELAY="$MOCK_DELAY" \
  APP_HEAP="${APP_HEAP:-1g}" APP_MEM="${APP_MEM:-1600m}" \
  FANOUT_ENABLED="$4" PUSH_ENABLED="$5" \
  SCHEDULING_ENABLED="$([ "$role_off" = true ] && echo false || echo true)" \
  CAPTION_ENABLED="$([ "$role_off" = true ] && echo false || echo true)" \
  FANOUT_CONCURRENCY="$FANOUT_CONC" PUSH_CONCURRENCY="$PUSH_CONC" \
    compose up -d --wait --wait-timeout 300 app > /dev/null 2>&1 || fail "앱 기동 실패"
  local env_dump
  env_dump="$(docker inspect "$(compose ps -q app)" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null)"
  echo "   앱이 받은 값 — 팬아웃 소비자 $(grep -oP 'NOTIFICATION_FANOUT_LISTENER_CONCURRENCY=\K.*' <<< "$env_dump")" \
       "· 푸시 소비자 $(grep -oP 'NOTIFICATION_PUSH_LISTENER_CONCURRENCY=\K.*' <<< "$env_dump")" \
       "· 동시 상한 $(grep -oP 'NOTIFICATION_WEB_PUSH_MAX_IN_FLIGHT=\K.*' <<< "$env_dump")"
}

# 발송 노드를 여러 대 띄운다. 노드마다 물리 코어 하나씩 주고, 전부 푸시 전용으로 둔다.
# 세 서비스가 같은 이미지 태그를 가리키므로 산출물은 하나다(compose 주석 참조).
start_push_nodes() {  # $1 노드 수
  local n="$1" svcs=() i=0 set_i cpuset
  compose rm -sf app app2 app3 > /dev/null 2>&1 || true
  IFS='|' read -r -a set_i <<< "$PUSH_NODE_CPUSETS"
  [ "$n" -le "${#set_i[@]}" ] || fail "노드 $n대에 줄 cpuset이 모자라다(${#set_i[@]}개)"
  for ((i = 0; i < n; i++)); do
    case "$i" in
      0) svcs+=(app);  export APP_CPUSET="${set_i[i]}" ;;
      1) svcs+=(app2); export APP2_CPUSET="${set_i[i]}" ;;
      2) svcs+=(app3); export APP3_CPUSET="${set_i[i]}" ;;
    esac
  done
  PG_CPUSET="$PG_FANOUT" INFRA_CPUSET="$INFRA_FANOUT" MOCK_DELAY="$MOCK_DELAY" \
  APP_HEAP="${APP_HEAP:-1g}" APP_MEM="${APP_MEM:-1600m}" \
  FANOUT_ENABLED=false PUSH_ENABLED=true \
  SCHEDULING_ENABLED="$([ "$PUSH_ROLE_ONLY" = true ] && echo false || echo true)" \
  CAPTION_ENABLED="$([ "$PUSH_ROLE_ONLY" = true ] && echo false || echo true)" \
  FANOUT_CONCURRENCY="$FANOUT_CONC" PUSH_CONCURRENCY="$PUSH_CONC" \
    compose up -d --wait --wait-timeout 300 "${svcs[@]}" > /dev/null 2>&1 \
    || fail "발송 노드 기동 실패"
  for svc in "${svcs[@]}"; do
    cpuset="$(docker inspect "$(compose ps -q "$svc")" --format '{{.HostConfig.CpusetCpus}}' 2>/dev/null)"
    echo "   발송 노드 $svc — cpuset[$cpuset] 소비자 $(docker inspect "$(compose ps -q "$svc")" \
      --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | grep -oP 'NOTIFICATION_PUSH_LISTENER_PREFETCH=\K.*' | head -1) prefetch"
  done
}

reset_state() {
  pg -c "TRUNCATE core.notification, core.notification_content,
                core.notification_push_progress, core.outbox_events CASCADE;" > /dev/null
  pg -c "VACUUM (ANALYZE) core.push_subscription;" > /dev/null
  pg -c "CHECKPOINT;" > /dev/null
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout < /dev/null > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push < /dev/null > /dev/null 2>&1 || true
  # DLQ도 비운다. 안 비우면 옛 회차가 남긴 메시지가 durable로 계속 남아, 이번 회차가 아무것도
  # 실패시키지 않았는데 DLQ 경보(ADR-0133)가 서 있는 상태가 된다. 실제로 하루 전 회차의
  # 메시지 한 건이 그대로 있었다.
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.fanout.dlq < /dev/null > /dev/null 2>&1 || true
  compose exec -T rabbitmq rabbitmqctl purge_queue notification.push.dlq < /dev/null > /dev/null 2>&1 || true
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
build_app
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
  if [ "$PUSH_NODES" -le 1 ]; then
    start_app "$PG_FANOUT" "$INFRA_FANOUT" "$APP_PUSH" false true
  else
    start_push_nodes "$PUSH_NODES"
  fi
  echo "   소비자 실효 prefetch — $(compose exec -T rabbitmq rabbitmqctl list_consumers \
        queue_name prefetch_count < /dev/null 2>/dev/null \
        | awk '$1=="notification.push"{print $2}' | sort | uniq -c | tr '\n' ' ')"
  T_PUSH_START="$(now_ms)"
  sample_until 0 "$SUBS" "$OUT/samples-push.csv"
  T_END="$(now_ms)"
fi

MOCK_STATS="$(mock /stats 2>/dev/null || echo '{}')"
echo "$MOCK_STATS" > "$OUT/mock.json"

python3 - "$OUT" "$MODE" "${T0:-0}" "${T_END:-0}" "${T_FANOUT_END:-0}" "${T_PUSH_START:-0}" "${FAN_MAX:-0}" "${FAN_MIN:-0}" <<'PY'
import csv, json, os, sys
out, mode = sys.argv[1], sys.argv[2]
t0, t_end, t_fan, t_push0, fan_max, fan_min = (int(x) for x in sys.argv[3:9])
# t0는 하네스가 아웃박스 행을 psql로 넣은 시각이다. 그 행은 afterCommit 깨우기 경로를 안 타므로
# 릴레이가 폴링으로 집을 때까지(0~RELAY_DELAY_MS) 기다리고, 그 대기가 t0 기준 값에 통째로 얹힌다
# (ADR-0134·0135). 팬아웃 자체는 행에 박힌 시각으로 잰다 — created_at 기본값이 clock_timestamp()다.
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

    origin = fan_min or t0          # 첫 알림 행 = 팬아웃이 실제로 시작한 시각
    lag = S(first_push - origin)
    fan = S(fan_done - origin)
    total = S(last_push - origin)
    overlap = S(fan_done - first_push)
    relay_wait = S(origin - t0)     # 하네스가 넣은 행을 릴레이가 집기까지

    print("   (하네스 적재 → 첫 알림 행 %.2f초 — 릴레이 폴링 대기. 운영은 커밋이 깨운다)" % relay_wait)
    print("   사건 → 첫 발송        %7.2f초   (발송이 팬아웃을 기다리지 않는다)" % lag)
    print("   사건 → 팬아웃 완료    %7.2f초" % fan)
    print("   사건 → 마지막 발송    %7.2f초" % total)
    print()
    print("   겹친 구간             %7.2f초   팬아웃과 발송이 동시에 돈 시간" % overlap)
    print("   겹침 비율             %7.1f%%   팬아웃 시간 중" % (100 * overlap / fan if fan else 0))
    summary = {"mode": mode, "lag_s": lag, "fanout_s": fan, "total_s": total,
               "overlap_s": overlap, "relay_wait_s": relay_wait}
else:
    fan = S(fan_max - fan_min) if fan_min else S(t_fan - t0)
    push = S(t_end - t_push0)
    print("   (하네스 적재 → 첫 알림 행 %.2f초 — 릴레이 폴링 대기)" % S((fan_min or t0) - t0))
    print("   팬아웃 (pg에 코어)     %7.2f초   첫 행~마지막 행" % fan)
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
