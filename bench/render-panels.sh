#!/usr/bin/env bash
#
# 회차별 시각 범위를 받아 Grafana 에 구간 주석을 달고 패널을 PNG 로 뽑는다.
#
# **관측 머신에서 돈다.** 측정 머신에는 Prometheus 도 Grafana 도 없다. 관측 컨테이너가
# 측정 머신에서 같이 돌면 코어를 나눠 쓰기 때문이다(실측 팬아웃 18.3→20.976초, +15%).
# 측정 머신은 run-oom-evidence.sh 가 남긴 ranges.csv 만 넘겨 준다.
#
# 주석을 다는 이유는 캡션과 그림을 붙여 두기 위해서다. 곡선 두 개가 한 축에 겹칠 때
# "왼쪽이 일괄"이라고 캡션에 쓰면 그림과 글이 떨어진다. 구간에 이름이 붙어 있으면 그림만
# 봐도 읽힌다.
#
# 사용법
#   bash bench/render-panels.sh <ranges.csv> [출력디렉터리]
#   GRAF=http://127.0.0.1:13000 GRAF_AUTH=admin:admin bash bench/render-panels.sh ...
#
#   ranges.csv 형식 (첫 줄은 머리글)
#     조각,시작ms,끝ms
#     1100000,1787900000000,1787900021390
#     5000,1787900060000,1787900085940
set -uo pipefail

RANGES="${1:-}"
OUT="${2:-bench/results/panels-$(date +%Y%m%dT%H%M%S)}"
GRAF="${GRAF:-http://127.0.0.1:13000}"
GRAF_AUTH="${GRAF_AUTH:-admin:admin}"
DASH_UID="${DASH_UID:-fanout-bench}"
PAD_MS="${PAD_MS:-20000}"   # 앞뒤 여유. 곡선이 화면 가장자리에 붙으면 읽기 어렵다

fail() { echo "실패: $*" >&2; exit 1; }
[ -n "$RANGES" ] || fail "ranges.csv 경로를 달라. 사용법은 이 파일 머리말에 있다"
[ -r "$RANGES" ] || fail "$RANGES 를 못 읽는다"
mkdir -p "$OUT"

curl -sf --max-time 5 -u "$GRAF_AUTH" "$GRAF/api/health" > /dev/null \
  || fail "Grafana($GRAF)에 못 붙는다. 관측 머신에서 돌리고 있는지 보라"

# ── 기존 주석을 지운다 ───────────────────────────────────────────────────────
# 같은 대시보드에 회차를 여러 번 돌리면 옛 주석이 겹쳐 그림이 지저분해진다.
OLD="$(curl -s --max-time 10 -u "$GRAF_AUTH" \
        "$GRAF/api/annotations?dashboardUID=$DASH_UID&tags=oom&limit=200" \
       | python3 -c 'import sys,json;print(" ".join(str(a["id"]) for a in json.load(sys.stdin)))' 2>/dev/null)"
for id in $OLD; do
  curl -s --max-time 5 -X DELETE -u "$GRAF_AUTH" "$GRAF/api/annotations/$id" > /dev/null 2>&1 || true
done
[ -n "$OLD" ] && echo "  옛 주석 $(echo "$OLD" | wc -w | tr -d ' ')개 지움"

# ── 회차마다 구간 주석 ───────────────────────────────────────────────────────
FROM=""; TO=""
while IFS=, read -r slice t0 t1; do
  case "$slice" in ''|조각) continue ;; esac
  case "$t0$t1" in *[!0-9]*) continue ;; esac
  curl -s --max-time 10 -u "$GRAF_AUTH" -H 'Content-Type: application/json' \
    -d "{\"dashboardUID\":\"$DASH_UID\",\"time\":$t0,\"timeEnd\":$t1,\"tags\":[\"oom\"],\"text\":\"조각 $slice\"}" \
    "$GRAF/api/annotations" > /dev/null || fail "주석을 못 달았다 (조각 $slice)"
  echo "  주석  조각 $slice  $t0 ~ $t1"
  [ -z "$FROM" ] && FROM="$t0"
  TO="$t1"
done < "$RANGES"
[ -n "$FROM" ] || fail "$RANGES 에 쓸 만한 줄이 없다"

FROM=$(( FROM - PAD_MS ))
TO=$(( TO + PAD_MS ))

# ── 패널을 PNG 로 ────────────────────────────────────────────────────────────
# 대시보드 전체가 아니라 패널 하나씩 뽑는다. 관계없는 패널이 같이 들어가면
# 증명할 것만 보여준다는 기준이 깨진다.
render() {  # $1=패널번호 $2=파일명
  curl -s --max-time 180 -u "$GRAF_AUTH" -o "$OUT/$2" \
    "$GRAF/render/d-solo/$DASH_UID/fanout?orgId=1&panelId=$1&from=$FROM&to=$TO&width=1500&height=520&theme=light&tz=Asia%2FSeoul"
  # 렌더가 실패해도 curl 은 0 을 낸다(오류 본문을 그대로 받는다). 매직 바이트로 판정한다.
  # grep 으로 보면 안 된다 — 개행 없는 4바이트 이진 입력에서 BSD grep 은 1 을 낸다.
  python3 -c "import sys;sys.exit(0 if open(sys.argv[1],'rb').read(8)==b'\x89PNG\r\n\x1a\n' else 1)" \
    "$OUT/$2" \
    || { head -c 300 "$OUT/$2" >&2; echo; fail "패널 $1 렌더 실패. 위 응답을 보라"; }
  echo "  $OUT/$2  $(wc -c < "$OUT/$2" | tr -d ' ') 바이트"
}

echo
render 7 panel-pg-memory.png
render 4 panel-jvm-heap.png

echo
echo "  대시보드   $GRAF/d/$DASH_UID?from=$FROM&to=$TO"
echo "  결과       $OUT"
