import { describe, expect, it } from 'vitest'
import {
  HIGHLIGHT_MAX_PER_SESSION,
  HIGHLIGHT_MIN_INTERVAL_MS,
  checkHighlightLimit,
} from '@/features/live-session/annotationHighlightLimit'

/**
 * 강조 캡처 상한(ADR-0074).
 *
 * <p>지금은 끄고 간다 — 얼마가 적당한지 쓰기 전에는 알 수 없고, 없는 근거로 강사를 막으면 기능을
 * 못 쓰게 만든다. 대신 판정 자리를 만들어 두고 <b>호출 지점이 지금도 이 함수를 거치게</b> 한다.
 * 그래야 켤 때 상수만 바꾸면 되고, 급한 순간에 호출 지점을 찾아 헤매지 않는다.
 */
describe('강조 캡처 상한', () => {
  it('기본값은 꺼져 있다 — 지금은 개수·간격 모두 제한하지 않는다', () => {
    expect(HIGHLIGHT_MAX_PER_SESSION).toBe(0)
    expect(HIGHLIGHT_MIN_INTERVAL_MS).toBe(0)
  })

  it('꺼져 있으면 몇 번을 연속으로 눌러도 허용한다', () => {
    const now = 1_000
    expect(checkHighlightLimit({ capturedCount: 999, lastCapturedAt: now }, now).allowed).toBe(true)
  })

  it('개수를 켜면 그만큼만 허용한다', () => {
    const state = { capturedCount: 3, lastCapturedAt: null }
    expect(checkHighlightLimit(state, 0, 3, 0)).toMatchObject({ allowed: false, reason: 'MAX_REACHED' })
    expect(checkHighlightLimit({ ...state, capturedCount: 2 }, 0, 3, 0).allowed).toBe(true)
  })

  it('간격을 켜면 너무 이른 캡처를 막는다', () => {
    const state = { capturedCount: 1, lastCapturedAt: 10_000 }
    expect(checkHighlightLimit(state, 13_000, 0, 5_000))
      .toMatchObject({ allowed: false, reason: 'TOO_SOON' })
    expect(checkHighlightLimit(state, 15_000, 0, 5_000).allowed).toBe(true)
  })

  it('첫 캡처는 간격 제한에 걸리지 않는다', () => {
    expect(checkHighlightLimit({ capturedCount: 0, lastCapturedAt: null }, 0, 0, 5_000).allowed).toBe(true)
  })
})
