import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENTRY_WINDOW_MINUTES,
  entryOpensAtOf,
  entryWindowMinutesOf,
  isLiveEntryOpen,
} from '@/features/live-session/liveEntry'

describe('isLiveEntryOpen', () => {
  const scheduledAt = '2026-08-01T10:00:00+09:00'

  it('입장창을 모르면 기본값(10분) 전부터 허용한다', () => {
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

describe('강사가 정한 입장창을 지킨다', () => {
  /*
   * 강사는 입장창을 0~60분으로 정하고 서버는 그 값을 지킨다. 예전에는 화면이 10분으로 굳어 있어,
   * 30분 창으로 연 강의에서 학생이 20분을 문 앞에 서 있었다. 반대로 5분 창이면 버튼이 먼저 열려
   * 눌러도 서버가 막았다.
   */
  const scheduledAt = '2026-08-01T10:00:00+09:00'
  const at = (iso: string) => new Date(iso).getTime()

  it('30분 창이면 30분 전부터 열린다', () => {
    const live = { status: 'SCHEDULED' as const, scheduledAt, entryWindowMinutes: 30 }
    expect(isLiveEntryOpen(live, at('2026-08-01T09:29:59+09:00'))).toBe(false)
    expect(isLiveEntryOpen(live, at('2026-08-01T09:30:00+09:00'))).toBe(true)
  })

  it('5분 창이면 10분 전에는 아직 닫혀 있다', () => {
    const live = { status: 'SCHEDULED' as const, scheduledAt, entryWindowMinutes: 5 }
    expect(isLiveEntryOpen(live, at('2026-08-01T09:50:00+09:00'))).toBe(false)
    expect(isLiveEntryOpen(live, at('2026-08-01T09:55:00+09:00'))).toBe(true)
  })

  it('0분 창이면 예정 시각에 열린다', () => {
    // ?? 로 기본값을 씌우면 0이 10으로 바뀐다 — 그 실수를 여기서 잡는다.
    const live = { status: 'SCHEDULED' as const, scheduledAt, entryWindowMinutes: 0 }
    expect(isLiveEntryOpen(live, at('2026-08-01T09:59:59+09:00'))).toBe(false)
    expect(isLiveEntryOpen(live, at('2026-08-01T10:00:00+09:00'))).toBe(true)
  })

  it('서버가 준 entryOpensAt이 있으면 그쪽이 이긴다', () => {
    // 계산은 서버가 진실이다. 두 값이 어긋나면 서버 값을 따른다.
    const live = {
      status: 'SCHEDULED' as const,
      scheduledAt,
      entryWindowMinutes: 10,
      entryOpensAt: '2026-08-01T09:20:00+09:00',
    }
    expect(isLiveEntryOpen(live, at('2026-08-01T09:20:00+09:00'))).toBe(true)
    expect(entryOpensAtOf(live)?.toISOString()).toBe(new Date('2026-08-01T09:20:00+09:00').toISOString())
  })

  it('입장창을 모르면 기본값으로 본다', () => {
    expect(entryWindowMinutesOf({ entryWindowMinutes: null })).toBe(DEFAULT_ENTRY_WINDOW_MINUTES)
    expect(entryWindowMinutesOf({ entryWindowMinutes: undefined })).toBe(DEFAULT_ENTRY_WINDOW_MINUTES)
    expect(entryWindowMinutesOf({ entryWindowMinutes: 0 })).toBe(0)
  })
})
