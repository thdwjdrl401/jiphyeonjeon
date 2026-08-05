import { describe, expect, it, vi } from 'vitest'
import {
  createRenderStats,
  formatRenderSummary,
  summarizeRenders,
  type RenderSample,
} from '@/features/live-session/annotationRenderStats'

/**
 * 렌더 실측 집계(ADR-0051 후속).
 *
 * <p>이 계측이 답하려는 질문은 하나다 — <b>요소가 쌓여도 지연이 평평한가.</b> 그래서 요소 수와
 * 지연이 한 줄에 같이 나와야 하고, op마다(33.6ms) 찍혀서는 안 된다. 그 로깅 자체가 부하가 된다.
 */

function sample(over: Partial<RenderSample> = {}): RenderSample {
  return { elements: 10, settledRedrawn: false, exportMs: 5, lagMs: 20, ...over }
}

describe('판서 렌더 실측 집계', () => {
  it('표본이 없으면 요약하지 않는다 — 판서 없는 강의는 아무것도 남기지 않는다', () => {
    expect(summarizeRenders([])).toBeNull()
  })

  it('중앙값과 최대값을 낸다', () => {
    const summary = summarizeRenders([
      sample({ exportMs: 1, lagMs: 10 }),
      sample({ exportMs: 5, lagMs: 50 }),
      sample({ exportMs: 3, lagMs: 30 }),
    ])!
    expect(summary.renders).toBe(3)
    expect(summary.exportP50).toBe(3)
    expect(summary.exportMax).toBe(5)
    expect(summary.lagP50).toBe(30)
    expect(summary.lagMax).toBe(50)
  })

  /** 아래 겹 재렌더 비율이 낮아야 절약이 먹히고 있다는 뜻이다. */
  it('아래 겹을 다시 그린 횟수를 따로 센다', () => {
    const summary = summarizeRenders([
      sample({ settledRedrawn: true }),
      sample(),
      sample(),
      sample(),
    ])!
    expect(summary.settledRedraws).toBe(1)
    expect(summary.renders).toBe(4)
  })

  /** 창의 <b>마지막</b> 문서 크기를 쓴다 — 강의가 진행되며 커지는 값이라 최신이 의미 있다. */
  it('요소 수는 창의 마지막 값이다', () => {
    expect(summarizeRenders([sample({ elements: 10 }), sample({ elements: 42 })])!.elements).toBe(42)
  })

  it('요소 수와 지연이 한 줄에 같이 나온다', () => {
    const line = formatRenderSummary(summarizeRenders([
      sample({ elements: 210, lagMs: 12.34, exportMs: 3.21, settledRedrawn: true }),
    ])!)
    expect(line).toContain('[판서렌더]')
    expect(line).toContain('요소=210')
    expect(line).toContain('지연 p50=12.3ms')
    expect(line).toContain('export p50=3.2ms')
    expect(line).toContain('아래겹 재렌더 1회')
  })

  describe('창 단위 보고', () => {
    /**
     * op는 33.6ms마다 온다. 그때마다 한 줄이면 두 시간 강의가 20만 줄이 되고, 로깅이 다시 부하가
     * 된다 — 재려는 대상을 재는 행위가 망가뜨리는 꼴이다.
     */
    it('창이 지나기 전에는 내보내지 않는다', () => {
      const report = vi.fn()
      let now = 0
      const stats = createRenderStats({ report, now: () => now, windowMs: 10_000 })

      for (let i = 0; i < 100; i += 1) {
        now += 33.6
        stats.record(sample())
      }

      expect(report).not.toHaveBeenCalled()
    })

    it('창이 지나면 한 줄만 내보내고 표본을 비운다', () => {
      const report = vi.fn()
      let now = 0
      const stats = createRenderStats({ report, now: () => now, windowMs: 1_000 })

      stats.record(sample({ elements: 5 }))
      now = 1_500
      stats.record(sample({ elements: 7 }))
      expect(report).toHaveBeenCalledTimes(1)
      expect(report.mock.calls[0][0]).toContain('요소=7')

      // 다음 창은 앞의 표본을 물려받지 않는다.
      now = 3_000
      stats.record(sample({ elements: 9 }))
      expect(report).toHaveBeenCalledTimes(2)
      expect(report.mock.calls[1][0]).toContain('렌더=1회')
    })

    /** 그리지 않는 동안에는 아무 일도 하지 않는다 — 타이머를 두지 않는 이유다. */
    it('렌더가 없으면 시간이 아무리 흘러도 내보내지 않는다', () => {
      const report = vi.fn()
      let now = 0
      createRenderStats({ report, now: () => now, windowMs: 1_000 })
      now = 600_000
      expect(report).not.toHaveBeenCalled()
    })
  })
})
