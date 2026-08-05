/**
 * Egress 판서 렌더 실측(ADR-0051 후속).
 *
 * <p><b>무엇을 확인하려는 것인가.</b> 판서 렌더를 두 겹으로 나눈 이유는 "op당 비용이 문서 크기에
 * 비례해 자라는 것"을 끊기 위해서다. 그게 실제로 끊겼는지는 <b>요소가 쌓여도 지연이 평평한가</b>로만
 * 확인할 수 있고, 그건 실제 강의에서만 나온다 — 로컬에서 헤드리스 Chrome이 1080p30을 인코딩하는
 * 경합을 만들 수 없다.
 *
 * <p><b>왜 집계하는가.</b> op는 33.6ms마다 온다. 그때마다 한 줄씩 찍으면 그 로깅이 다시 부하가 되고,
 * 두 시간짜리 강의가 20만 줄을 남긴다. 창(기본 10초) 단위로 접어 한 줄만 낸다.
 *
 * <p><b>어디서 읽는가.</b> Egress 페이지는 평범한 라우트(`/egress/stage`)라 같은 URL을 브라우저로
 * 열면 콘솔에서 그대로 보인다. `START_RECORDING`/`END_RECORDING`과 달리 Egress 컨테이너가 해석하는
 * 값이 아니므로 접두사만 구분되면 된다.
 */

/** 렌더 한 번의 실측치. */
export interface RenderSample {
  /**
   * 이 렌더가 다룬 문서의 요소 수.
   *
   * <p><b>이 값과 지연의 관계가 이 계측의 전부다.</b> 예전 구조에서는 둘이 비례해서 자랐다.
   */
  elements: number
  /** 아래 겹을 다시 그렸는가. 이 비율이 낮을수록 절약이 먹히고 있다는 뜻이다. */
  settledRedrawn: boolean
  /** export에 든 시간(이번 렌더에서 그린 겹 전부). */
  exportMs: number
  /**
   * op 도착 → 화면 커밋까지. <b>수강생이 실제로 겪는 지연</b>이다.
   *
   * <p>렌더가 밀려 중간 상태를 건너뛰었다면 그 시간까지 포함한다 — 건너뛴 것은 잃은 것이 없지만
   * 기다린 시간은 실재하기 때문이다.
   */
  lagMs: number
}

export interface RenderSummary {
  /** 창 안에서 실제로 그린 횟수. */
  renders: number
  /** 그중 아래 겹까지 다시 그린 횟수. */
  settledRedraws: number
  /** 창의 마지막 문서 크기. */
  elements: number
  exportP50: number
  exportMax: number
  lagP50: number
  lagMax: number
}

function percentile50(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/** 표본을 요약한다. 표본이 없으면 null — 판서를 쓰지 않는 강의는 아무것도 남기지 않는다. */
export function summarizeRenders(samples: readonly RenderSample[]): RenderSummary | null {
  if (samples.length === 0) return null
  return {
    renders: samples.length,
    settledRedraws: samples.filter((sample) => sample.settledRedrawn).length,
    elements: samples[samples.length - 1].elements,
    exportP50: percentile50(samples.map((sample) => sample.exportMs)),
    exportMax: Math.max(...samples.map((sample) => sample.exportMs)),
    lagP50: percentile50(samples.map((sample) => sample.lagMs)),
    lagMax: Math.max(...samples.map((sample) => sample.lagMs)),
  }
}

/**
 * 한 줄로 만든다.
 *
 * <p>요소 수를 <b>맨 앞</b>에 둔다. 강의가 진행되며 이 값이 커지는 동안 `lag`가 따라 커지지 않는지가
 * 보려는 전부라, 두 값이 눈에 같이 들어와야 한다.
 */
export function formatRenderSummary(summary: RenderSummary): string {
  const round = (value: number) => Math.round(value * 10) / 10
  return `[판서렌더] 요소=${summary.elements}`
    + ` 지연 p50=${round(summary.lagP50)}ms 최대=${round(summary.lagMax)}ms`
    + ` | export p50=${round(summary.exportP50)}ms 최대=${round(summary.exportMax)}ms`
    + ` | 렌더=${summary.renders}회(아래겹 재렌더 ${summary.settledRedraws}회)`
}

export interface RenderStats {
  /** 렌더 한 번을 기록한다. 창이 지났으면 그 자리에서 요약을 낸다. */
  record(sample: RenderSample): void
}

export interface RenderStatsOptions {
  /** 요약을 내보내는 곳. 기본은 콘솔. */
  report?: (line: string) => void
  now?: () => number
  /** 요약 주기(ms). */
  windowMs?: number
}

/** 기본 요약 주기. 강의 한 시간이면 360줄 — 사람이 훑을 수 있는 양이다. */
export const RENDER_STATS_WINDOW_MS = 10_000

/**
 * 표본을 모아 주기적으로 한 줄씩 내보낸다.
 *
 * <p><b>타이머를 쓰지 않는다.</b> 렌더가 들어올 때만 창이 지났는지 본다 — 판서를 그리지 않는
 * 동안에는 아무 일도 하지 않아야 하고, 정리해야 할 타이머가 없으면 언마운트 경로도 단순해진다.
 * 대신 마지막 조각은 다음 렌더가 없으면 나오지 않는데, 그건 이미 그리기가 멈춘 구간이라 잃을 것이
 * 없다.
 */
export function createRenderStats(options: RenderStatsOptions = {}): RenderStats {
  const report = options.report ?? ((line: string) => { console.info(line) })
  const now = options.now ?? (() => performance.now())
  const windowMs = options.windowMs ?? RENDER_STATS_WINDOW_MS

  let samples: RenderSample[] = []
  let windowStartedAt: number | null = null

  return {
    record(sample) {
      const at = now()
      if (windowStartedAt === null) windowStartedAt = at
      samples.push(sample)
      if (at - windowStartedAt < windowMs) return

      const summary = summarizeRenders(samples)
      if (summary) report(formatRenderSummary(summary))
      samples = []
      windowStartedAt = at
    },
  }
}
