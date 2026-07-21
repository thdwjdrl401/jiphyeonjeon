import { describe, expect, it } from 'vitest'
import { isLiveEntryOpen } from './liveEntry'

describe('isLiveEntryOpen', () => {
  const scheduledAt = '2026-08-01T10:00:00+09:00'

  it('예정 강의는 시작 10분 전부터 입장을 허용한다', () => {
    expect(isLiveEntryOpen({ status: 'SCHEDULED', scheduledAt }, new Date('2026-08-01T09:49:59+09:00').getTime())).toBe(false)
    expect(isLiveEntryOpen({ status: 'SCHEDULED', scheduledAt }, new Date('2026-08-01T09:50:00+09:00').getTime())).toBe(true)
  })

  it('서버 상태가 입장 가능 또는 진행 중이면 예정 시각과 무관하게 허용한다', () => {
    expect(isLiveEntryOpen({ status: 'OPEN', scheduledAt }, 0)).toBe(true)
    expect(isLiveEntryOpen({ status: 'LIVE', scheduledAt }, 0)).toBe(true)
  })

  it('종료되거나 취소된 강의에는 입장을 허용하지 않는다', () => {
    expect(isLiveEntryOpen({ status: 'ENDED', scheduledAt }, Date.now())).toBe(false)
    expect(isLiveEntryOpen({ status: 'CANCELLED', scheduledAt }, Date.now())).toBe(false)
  })
})
