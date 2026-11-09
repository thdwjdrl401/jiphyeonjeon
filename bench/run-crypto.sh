#!/usr/bin/env bash
#
# Web Push 암호화 단건 비용 측정 — 통제된 실행.
#
# 이 값에서 발송 처리량의 상한이 나오고, 거기서 "100만 명을 1분 안에 보내려면 코어가 몇 개
# 필요한가"를 역산한다. 그래서 측정 조건이 결과만큼 중요하다.
#
# 통제하는 것
#   · cpuset을 **물리 코어 단위**로 고정 (형제 스레드를 쪼개 주면 컨테이너끼리 서로 훔친다)
#   · --cpus(CFS quota)를 쓰지 않는다 — 100ms 주기 스로틀링이 꼬리 지연에 계단을 만든다
#   · 힙 고정 + AlwaysPreTouch — 측정 중 페이지 폴트와 힙 확장을 뺀다
#   · 실행 전후 주파수·온도 기록 — i7-6700HQ는 45W 모바일 칩이라 열 스로틀링이 실재한다
#   · 스레드 수를 올리는 순서를 뒤집어 두 번 돌린다 — 시간 드리프트가 결과에 실리지 않게
#
# 사용법
#   # gradlew는 저장소 루트가 아니라 backend/ 에 있다. 호스트에 JDK 21이 없어도 되게
#   # 컨테이너로 빌드한다(호스트 경로와 같은 경로로 마운트 — 옛 CI와 같은 방식).
#   docker run --rm -v "$PWD:$PWD" -w "$PWD/backend" -v gradle-cache:/root/.gradle \
#              eclipse-temurin:21-jdk ./gradlew benchDist --no-daemon
#   bench/run-crypto.sh [결과디렉토리]
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO_ROOT/backend/build/bench"
OUT="${1:-$REPO_ROOT/bench/results/crypto-$(date +%Y%m%dT%H%M%S)}"

JDK_IMAGE="eclipse-temurin:21-jdk"
ITERATIONS="${ITERATIONS:-200000}"
WARMUP="${WARMUP:-50000}"
KEYS="${KEYS:-1000}"
HEAP="${HEAP:-2g}"
# 잴 물리 코어 수 목록. 확인용 짧은 실행은 CORES="1 4" 처럼 줄여 쓴다.
CORES="${CORES:-1 2 3 4}"
# 패스 사이 쿨다운(초). 열 드리프트를 가라앉히는 시간이라 짧은 확인 실행에서는 줄여도 된다.
COOLDOWN="${COOLDOWN:-60}"

# 물리 코어 N개에 해당하는 논리 CPU 목록. 형제 쌍을 통째로 준다.
# lscpu -e=CPU,CORE 로 확인한 lazy의 배치: (0,4) (1,5) (2,6) (3,7)
cpuset_for() {
  case "$1" in
    1) echo "0,4" ;;
    2) echo "0,4,1,5" ;;
    3) echo "0,4,1,5,2,6" ;;
    4) echo "0,4,1,5,2,6,3,7" ;;
    *) echo "지원하지 않는 물리 코어 수: $1" >&2; exit 2 ;;
  esac
}

mkdir -p "$OUT"

# ---- 사전 검사 ---------------------------------------------------------------

fail() { echo "PREFLIGHT 실패: $*" >&2; exit 1; }

# 중복 실행 방지. **잔여물 정리보다 먼저** 해야 두 인스턴스가 서로의 컨테이너를 지우지 않는다.
#
# 앞서 두 방식이 실패했다.
#   pgrep — `$(...)` 명령 치환이 만드는 서브셸이 부모의 cmdline을 그대로 물려받아
#           자기 자신이 잡힌다. 그 서브셸은 검사가 끝나면 사라져서 "있다는데 ps엔 없는"
#           PID가 나온다.
#   flock — 잠금이 fd에 걸리는데 그 fd를 **모든 자식이 물려받는다**. kill -9로 스크립트를
#           죽이면 살아남은 샘플러·docker run·sleep이 잠금을 계속 쥔다.
#
# PID 파일 + 생존 확인은 둘 다 피한다. 죽은 PID는 kill -0이 걸러 내고, PID 재사용은
# cmdline 대조가 걸러 낸다. 자식에게 물려줄 상태가 없다.
PID_FILE="${TMPDIR:-/tmp}/run-crypto.pid"
if [ -f "$PID_FILE" ]; then
  other="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$other" ] && [ "$other" != "$$" ] && kill -0 "$other" 2>/dev/null \
     && tr '\0' ' ' < "/proc/$other/cmdline" 2>/dev/null | grep -q 'run-crypto'; then
    fail "run-crypto.sh가 이미 돌고 있다 (pid $other). 끝나기를 기다리거나 kill $other."
  fi
fi
echo "$$" > "$PID_FILE"

# 지난 실행의 잔여 컨테이너를 치운다.
# --rm을 줘도 남는 경우가 있다 — 같은 이름이 이미 쓰이고 있으면 docker run이
# 시작조차 못 하고, 그러면 --rm이 발동하지 않는다.
stale_containers="$(docker ps -aq --filter name=crypto-bench)"
if [ -n "$stale_containers" ]; then
  echo "지난 실행의 벤치 컨테이너를 정리한다: $(echo "$stale_containers" | wc -l)개"
  echo "$stale_containers" | xargs -r docker rm -f > /dev/null
fi

[ -d "$DIST" ] || fail "$DIST 가 없다. 먼저 빌드하라 —
  docker run --rm -v \"\$PWD:\$PWD\" -w \"\$PWD/backend\" -v gradle-cache:/root/.gradle \\
             eclipse-temurin:21-jdk ./gradlew benchDist --no-daemon
  (gradlew는 저장소 루트가 아니라 backend/ 에 있다)"

# 벤치 외 컨테이너가 돌면 CPU를 나눠 갖는다.
running="$(docker ps --format '{{.Names}}' | grep -v '^crypto-bench' || true)"
[ -z "$running" ] || fail "다른 컨테이너가 떠 있다: $running"

# self-hosted 러너가 같은 박스에 있다. master에 push가 들어오면 CI가 여기서 돈다.
# lazy에서는 러너가 컨테이너(github-runner)라 위 컨테이너 검사가 이미 잡지만,
# systemd로 돌리는 환경도 있으므로 둘 다 본다.
if systemctl is-active --quiet 'actions.runner.*' 2>/dev/null; then
  fail "GitHub Actions self-hosted 러너(systemd)가 동작 중이다. 측정 전에 멈춰라."
fi
if docker ps --format '{{.Names}}' | grep -q 'runner'; then
  fail "러너 컨테이너가 떠 있다. docker stop github-runner 후 재시도."
fi

# 스왑이 잡히면 결과가 통째로 왜곡된다.
# free 출력은 로케일마다 열 이름이 달라 /proc/meminfo를 직접 읽는다.
swap_total="$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)"
swap_free="$(awk '/^SwapFree:/{print $2}' /proc/meminfo)"
[ $(( swap_total - swap_free )) -eq 0 ] || \
  fail "스왑 사용 중($(( (swap_total - swap_free) / 1024 ))MB). swapoff -a 후 재시도."

for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  [ -r "$g" ] || continue
  [ "$(cat "$g")" = "performance" ] || fail "$g 가 performance가 아니다."
done

# ---- 환경 지문 ---------------------------------------------------------------

freqs() { grep -h '^cpu MHz' /proc/cpuinfo 2>/dev/null | awk '{print $4}' | paste -sd, - ; }
temps() { cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | paste -sd, - ; }

{
  echo "{"
  echo "  \"startedAt\": \"$(date -Is)\","
  echo "  \"gitSha\": \"$(git -C "$REPO_ROOT" rev-parse HEAD)\","
  echo "  \"gitDirty\": $(git -C "$REPO_ROOT" diff --quiet && echo false || echo true),"
  echo "  \"kernel\": \"$(uname -r)\","
  echo "  \"arch\": \"$(uname -m)\","
  echo "  \"cpuModel\": \"$(awk -F': ' '/model name/{print $2; exit}' /proc/cpuinfo)\","
  echo "  \"cgroup\": \"$(stat -fc %T /sys/fs/cgroup)\","
  echo "  \"docker\": \"$(docker version --format '{{.Server.Version}}')\","
  echo "  \"jdkImage\": \"$(docker image inspect -f '{{index .RepoDigests 0}}' "$JDK_IMAGE" 2>/dev/null || echo "$JDK_IMAGE")\","
  echo "  \"heap\": \"$HEAP\", \"iterations\": $ITERATIONS, \"warmup\": $WARMUP, \"keys\": $KEYS,"
  echo "  \"freqMhzBefore\": \"$(freqs)\","
  echo "  \"tempBefore\": \"$(temps)\""
  echo "}"
} > "$OUT/fingerprint.json"

echo "지문: $OUT/fingerprint.json"

# ---- 샘플러 -----------------------------------------------------------------
#
# 주파수·온도를 1초마다 CSV로 남긴다. 눈으로 보는 것(watch)은 기록이 아니라,
# "어느 실행 구간에서 떨어졌나"를 나중에 대조할 수 없다.
#
# 표본과 실행 구간을 각각 epoch ms로 남겨 두면 사후에 조인할 수 있고,
# 열 스로틀링이 섞인 실행을 **사람이 아니라 스크립트가** 골라낸다.
#
# 샘플러 자신의 비용은 초당 awk 한 번이라 무시할 만하고, 무엇보다 모든 실행에
# 똑같이 걸리므로 비교에는 영향이 없다.

SAMPLES="$OUT/samples.csv"
RUNS="$OUT/runs.csv"
echo "label,start_ms,end_ms" > "$RUNS"

start_sampler() {
  {
    # **errexit·pipefail을 끈다.** 상속된 채로 두면 온도 파일이 없는 기계에서
    # cat이 실패하고 pipefail이 파이프라인 전체를 실패로 만들어, 샘플러가
    # 첫 반복에 죽는다. 그러면 헤더만 남은 CSV가 생기고 요약은 전부 0을 찍는다.
    # 샘플러는 무엇이 없어도 계속 돌아야 한다.
    set +e +o pipefail

    printf 'epoch_ms'
    for i in $(seq 0 7); do printf ',cpu%d_mhz' "$i"; done
    printf ',temp_max_c\n'
    while :; do
      # /proc/cpuinfo의 cpu MHz가 없는 커널이 있어 sysfs를 대안으로 둔다(kHz라 1000으로 나눈다).
      mhz="$(awk '/^cpu MHz/{printf ",%.0f", $4}' /proc/cpuinfo 2>/dev/null)"
      if [ -z "$mhz" ]; then
        mhz="$(cat /sys/devices/system/cpu/cpu[0-7]/cpufreq/scaling_cur_freq 2>/dev/null \
               | awk '{printf ",%.0f", $1/1000}')"
      fi
      [ -n "$mhz" ] || mhz=",,,,,,,,"

      raw="$(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1)"
      case "$raw" in (*[!0-9]*|"") raw=0 ;; esac

      printf '%s%s,%d\n' "$(date +%s%3N)" "$mhz" "$(( raw / 1000 ))"
      sleep 1
    done
  } > "$SAMPLES" &
  SAMPLER_PID=$!
}

stop_sampler() {
  [ -n "${SAMPLER_PID:-}" ] && kill "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=""
}

# Ctrl-C로 끊어도 샘플러와 돌고 있던 컨테이너를 남기지 않는다.
# 이게 없으면 다음 실행이 "이름이 이미 쓰인다"로 막힌다.
cleanup() {
  stop_sampler
  rm -f "$PID_FILE"

  docker ps -aq --filter name=crypto-bench | xargs -r docker rm -f > /dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

start_sampler
echo "샘플러: $SAMPLES (1초 간격)"

# ---- 실행 -------------------------------------------------------------------

one_run() {
  local cores="$1" threads="$2" pass="$3"
  local cpus label
  cpus="$(cpuset_for "$cores")"
  label="cores${cores}-threads${threads}-pass${pass}"

  echo "▶ $label  (cpuset=$cpus)"

  local started_ms ended_ms
  started_ms="$(date +%s%3N)"

  docker run --rm \
    --name "crypto-bench-$label" \
    --cpuset-cpus "$cpus" \
    --label crypto-bench \
    --memory 3g --memory-swap 3g \
    -v "$DIST:/bench:ro" \
    -w /bench \
    "$JDK_IMAGE" \
    java -Xms"$HEAP" -Xmx"$HEAP" -XX:+AlwaysPreTouch -XX:+UseG1GC -XX:+PerfDisableSharedMem \
         -cp '/bench/*:/bench/lib/*' \
         com.liveclass.notification.push.CryptoBench \
         --threads "$threads" --warmup "$WARMUP" --iterations "$ITERATIONS" \
         --keys "$KEYS" --label "$label" \
    > "$OUT/$label.json" 2> "$OUT/$label.stderr"

  ended_ms="$(date +%s%3N)"
  echo "$label,$started_ms,$ended_ms" >> "$RUNS"

  grep -q throughputPerSecond "$OUT/$label.json" || { echo "   실패 — stderr 확인" >&2; return 1; }
  awk -F'[:,]' '/throughputPerSecond/{printf "   %.0f 건/s\n", $2}' "$OUT/$label.json"
}

# 물리 코어 1~4, 코어당 스레드 1개와 2개(SMT 이득 확인).
# **오름차순 한 번, 내림차순 한 번**을 돌려 열 드리프트를 상쇄한다.
PLAN_UP=()
for cores in $CORES; do
  PLAN_UP+=("$cores:$cores" "$cores:$((cores * 2))")
done
PLAN_DOWN=()
for (( i=${#PLAN_UP[@]}-1; i>=0; i-- )); do PLAN_DOWN+=("${PLAN_UP[$i]}"); done

# 예상 소요를 미리 찍는다. 반복 수가 **스레드마다** 붙으므로 스레드가 많은 조합이
# 그만큼 오래 걸린다 — 이걸 안 보면 "금방 끝나겠지"로 시작해서 20분을 기다리게 된다.
# 코어당 약 2,700건/s(이 기계 실측)로 어림한다.
estimate_seconds() {
  local total=0 cores threads calls rate
  for item in "${PLAN_UP[@]}"; do
    cores="${item%%:*}"; threads="${item##*:}"
    calls=$(( (WARMUP + ITERATIONS) * threads ))
    rate=$(( cores * 2700 ))
    total=$(( total + calls / rate + 4 ))   # +4초는 컨테이너 기동
  done
  echo $(( total * 2 + COOLDOWN ))
}
eta="$(estimate_seconds)"
echo "실행 $(( ${#PLAN_UP[@]} * 2 ))회 · 예상 $(( eta / 60 ))분 $(( eta % 60 ))초"
echo "  (줄이려면: ITERATIONS=30000 WARMUP=10000 CORES=\"1 4\" COOLDOWN=20)"
echo

for item in "${PLAN_UP[@]}";   do one_run "${item%%:*}" "${item##*:}" 1 || true; done
echo "── 쿨다운 ${COOLDOWN}초 ──"; sleep "$COOLDOWN"
for item in "${PLAN_DOWN[@]}"; do one_run "${item%%:*}" "${item##*:}" 2 || true; done

# ---- 사후 기록 ---------------------------------------------------------------

# 요약이 표본을 읽기 전에 샘플러를 멈춘다. 안 그러면 마지막 줄이 잘린 채로 읽힌다.
stop_sampler
sleep 1

python3 - "$OUT" <<'PY'
import csv, json, pathlib, re, statistics, sys

out = pathlib.Path(sys.argv[1])

# 실행 구간과 1초 표본을 epoch ms로 조인한다. 사람이 눈으로 본 것이 아니라
# 기록된 값으로 "이 실행 중에 주파수가 떨어졌는가"를 판정하기 위해서다.
windows = {}
with (out / "runs.csv").open() as f:
    for row in csv.DictReader(f):
        windows[row["label"]] = (int(row["start_ms"]), int(row["end_ms"]))

samples = []
with (out / "samples.csv").open() as f:
    for row in csv.reader(f):
        if not row or row[0] == "epoch_ms":
            continue
        try:
            samples.append((int(row[0]), [float(v) for v in row[1:-1]], float(row[-1])))
        except ValueError:
            continue   # 샘플러가 종료 중 잘린 줄

def during(label):
    start, end = windows.get(label, (0, 0))
    return [s for s in samples if start <= s[0] <= end]

rows = {}
for path in sorted(out.glob("cores*-threads*-pass*.json")):
    try:
        d = json.loads(path.read_text())
    except Exception:
        continue
    m = re.match(r"cores(\d+)-threads(\d+)-pass(\d+)", d["label"])
    if not m:
        continue
    window = during(d["label"])
    # 이 실행이 쓴 논리 CPU만 본다. 노는 코어의 주파수는 판정을 흐린다.
    used = int(m.group(1))
    order = [0, 4, 1, 5, 2, 6, 3, 7][: used * 2]
    active = [[f[i] for i in order if i < len(f)] for _, f, _ in window]
    d["freqMhzMean"] = statistics.mean([v for row in active for v in row]) if active else None
    d["freqMhzMin"] = min([v for row in active for v in row]) if active else None
    d["tempMaxC"] = max((t for _, _, t in window), default=None)
    d["samples"] = len(window)
    rows.setdefault((int(m.group(1)), int(m.group(2))), []).append(d)

print(f"\n{'코어':>4} {'스레드':>5} {'건/s(중앙)':>12} {'p50ms':>8} {'p99ms':>8} "
      f"{'1코어대비':>9} {'MHz평균':>8} {'MHz최저':>8} {'온도':>5} {'패스편차':>8}")

base = None
summary = []
warnings = []
for (cores, threads), runs in sorted(rows.items()):
    throughputs = [r["throughputPerSecond"] for r in runs]
    tp = statistics.median(throughputs)
    spread = (max(throughputs) - min(throughputs)) / tp if len(throughputs) > 1 else 0.0
    # 값이 없는 것과 0인 것을 구별한다. 샘플러가 죽었는데 "0MHz"로 찍히면
    # 버그가 결과처럼 읽힌다.
    freqs_mean = [r["freqMhzMean"] for r in runs if r["freqMhzMean"]]
    freqs_min = [r["freqMhzMin"] for r in runs if r["freqMhzMin"]]
    temps_max = [r["tempMaxC"] for r in runs if r["tempMaxC"]]
    freq_mean = statistics.mean(freqs_mean) if freqs_mean else None
    freq_min = min(freqs_min) if freqs_min else None
    temp = max(temps_max) if temps_max else None
    if base is None:
        base = tp
    print(f"{cores:>4} {threads:>5} {tp:>12.0f} "
          f"{statistics.median(r['perCallMillis']['p50'] for r in runs):>8.4f} "
          f"{statistics.median(r['perCallMillis']['p99'] for r in runs):>8.4f} "
          f"{tp / base:>8.2f}x "
          f"{(f'{freq_mean:.0f}' if freq_mean else '—'):>8} "
          f"{(f'{freq_min:.0f}' if freq_min else '—'):>8} "
          f"{(f'{temp:.0f}C' if temp else '—'):>5} {spread * 100:>7.1f}%")
    summary.append({"cores": cores, "threads": threads, "throughput": tp,
                    "spread": spread, "freqMhzMean": freq_mean, "freqMhzMin": freq_min,
                    "tempMaxC": temp, "vsOneCore": tp / base})
    # 두 패스가 10% 넘게 벌어지면 측정이 아니라 환경이 흔들린 것이다.
    if spread > 0.10:
        warnings.append(f"코어{cores}/스레드{threads}: 패스 간 편차 {spread * 100:.1f}%")

(out / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))

# 전코어 구간에서 주파수가 1코어 구간보다 크게 떨어졌으면 스케일링 비선형의 원인이다.
one = next((r for r in summary if r["cores"] == 1), None)
allc = next((r for r in summary if r["cores"] == 4), None)
if one and allc and one["freqMhzMean"] and allc["freqMhzMean"]:
    drop = 1 - allc["freqMhzMean"] / one["freqMhzMean"]
    print(f"\n주파수 1코어 {one['freqMhzMean']:.0f}MHz → 4코어 {allc['freqMhzMean']:.0f}MHz "
          f"({drop * 100:.1f}% 하락)")
    print("  선형에서 벗어난 몫 중 이만큼은 코드가 아니라 클럭이다.")

if not any(r["freqMhzMean"] for r in summary):
    print("\n경고: 주파수·온도 표본이 없다. 샘플러가 죽었거나 이 기계가 값을 노출하지 않는다.")
    print("       samples.csv 줄 수를 확인하라 — 헤더만 있으면 샘플러가 첫 반복에 죽은 것이다.")
    print("       처리량 자체는 유효하나, 선형에서 벗어난 몫을 클럭으로 설명할 수 없다.")

for w in warnings:
    print(f"\n경고: {w} — 그 조합은 재측정 권장")

# ---- 역산 ----
# 1코어 값이 아니라 **전코어 값**에서 코어당 처리량을 뽑는다. 스케일아웃하면
# 모든 코어가 바쁘고 그때는 전코어 클럭이 적용되므로, 1코어(싱글 터보) 기준으로
# 곱하면 과대 추정이 된다.
need = 1_200_000 / 60
# 같은 코어 수에서 여러 스레드 조합을 쟀으므로 그중 최댓값이 그 코어 수의 실력이다.
top_cores = max(r["cores"] for r in summary)
basis = max((r for r in summary if r["cores"] == top_cores), key=lambda r: r["throughput"])
per_core = basis["throughput"] / basis["cores"]

print(f"\n── 역산 (기준: 물리 {basis['cores']}코어 실측) ──")
print(f"목표            120만 건 / 60초 = {need:,.0f} 건/s")
print(f"현 서버 최대     {basis['throughput']:,.0f} 건/s → 120만 건에 "
      f"{1_200_000 / basis['throughput']:.0f}초 (목표의 {need / basis['throughput']:.1f}배 초과)")
print(f"코어당          {per_core:,.0f} 건/s")
print(f"필요 물리 코어   {need / per_core:.1f}")
print(f"  = i7-6700HQ급 4코어 서버 {need / per_core / 4:.1f}대")
print("\n주의: 이 수치는 암호화 CPU만이다. 실제 발송에는 HTTP 왕복·커넥션 관리·")
print("      진행 표 쓰기가 더 붙으므로 이것은 상한이지 달성치가 아니다.")
PY

echo
echo "결과: $OUT"
