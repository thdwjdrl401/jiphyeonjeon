#!/usr/bin/env bash
#
# 측정 구간의 Grafana 패널을 PNG 로 뽑는다.
#
# **관측 머신에서 돈다.** 측정 머신에는 Prometheus 도 Grafana 도 없다. 관측 컨테이너가
# 측정 머신에서 같이 돌면 코어를 나눠 쓰기 때문이다(실측 팬아웃 18.3→20.976초, +15%).
# 측정 머신은 run-oom-evidence.sh 가 남긴 ranges.csv 만 넘겨 준다.
#
# **구간 주석은 달지 않는다.** 회차마다 띠를 그려 봤더니 그 상자가 곡선을 덮어 정작 움직임이
# 안 보였고, 어디를 보라고 지시하는 꼴이라 작위적으로 읽혔다. 회차 사이를 30초 비워 두면
# 봉우리가 저절로 갈린다. 순서는 캡션에서 밝힌다.
#
# 이 스크립트는 확인용이다. 포트폴리오에 넣을 그림은 브라우저에서 직접 캡처한다.
#
# 사용법
#   bash bench/render-panels.sh <ranges.csv> [출력디렉터리]
#   PANELS="3 4 10" bash bench/render-panels.sh /tmp/ranges.csv
#   GRAF=http://127.0.0.1:13000 GRAF_AUTH=admin:admin bash bench/render-panels.sh ...
set -uo pipefail

RANGES="${1:-}"
OUT="${2:-bench/results/panels-$(date +%Y%m%dT%H%M%S)}"
GRAF="${GRAF:-http://127.0.0.1:13000}"
GRAF_AUTH="${GRAF_AUTH:-admin:admin}"
DASH_UID="${DASH_UID:-fanout-bench}"
PANELS="${PANELS:-3 4 5 10}"   # cgroup 메모리 · cgroup 이벤트 · 초당 삽입 · JVM 힙
PAD_MS="${PAD_MS:-25000}"      # 앞뒤 여유. 곡선이 화면 가장자리에 붙으면 읽기 어렵다

fail() { echo "실패: $*" >&2; exit 1; }
[ -n "$RANGES" ] || fail "ranges.csv 경로를 달라. 사용법은 이 파일 머리말에 있다"
[ -r "$RANGES" ] || fail "$RANGES 를 못 읽는다"
mkdir -p "$OUT"

curl -sf --max-time 5 -u "$GRAF_AUTH" "$GRAF/api/health" > /dev/null \
  || fail "Grafana($GRAF)에 못 붙는다. 관측 머신에서 돌리고 있는지 보라"

FROM=""; TO=""
while IFS=, read -r slice t0 t1; do
  case "$slice" in ''|조각) continue ;; esac
  case "$t0$t1" in *[!0-9]*) continue ;; esac
  [ -z "$FROM" ] && FROM="$t0"
  TO="$t1"
done < "$RANGES"
[ -n "$FROM" ] || fail "$RANGES 에 쓸 만한 줄이 없다"
FROM=$(( FROM - PAD_MS )); TO=$(( TO + PAD_MS ))

render() {  # $1=패널번호
  local f="$OUT/panel-$1.png"
  curl -s --max-time 180 -u "$GRAF_AUTH" -o "$f" \
    "$GRAF/render/d-solo/$DASH_UID/f?orgId=1&panelId=$1&from=$FROM&to=$TO&width=1500&height=460&theme=light&tz=Asia%2FSeoul"
  # 렌더가 실패해도 curl 은 0 을 낸다(오류 본문을 그대로 받는다). 매직 바이트로 판정한다.
  # grep 으로 보면 안 된다 — 개행 없는 4바이트 이진 입력에서 BSD grep 은 1 을 낸다.
  python3 -c "import sys;sys.exit(0 if open(sys.argv[1],'rb').read(8)==b'\x89PNG\r\n\x1a\n' else 1)" "$f" \
    || { head -c 300 "$f" >&2; echo; fail "패널 $1 렌더 실패. 위 응답을 보라"; }
  echo "  $f  $(wc -c < "$f" | tr -d ' ') 바이트"
}

for pid in $PANELS; do render "$pid"; done

echo
echo "  대시보드   $GRAF/d/$DASH_UID?from=$FROM&to=$TO"
echo "  결과       $OUT"
