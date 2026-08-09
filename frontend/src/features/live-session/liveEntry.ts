import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'

/**
 * 입장창을 모를 때 쓰는 값. 강의를 만들 때의 기본값과 같다.
 *
 * <p>알림 경로처럼 세션 전체를 들고 있지 않은 자리에서만 쓴다 — 세션을 들고 있으면 반드시
 * 실제 값을 넘겨야 한다. 강사는 0~60분으로 정할 수 있고 서버는 그 값을 지키는데, 화면만 10분으로
 * 굳어 있으면 30분 창인 강의에서 학생이 20분을 문 앞에 서 있게 된다.
 */
export const DEFAULT_ENTRY_WINDOW_MINUTES = 10

interface LiveEntryTiming {
  status: CurriculumLiveSessionStatus
  scheduledAt: string | null
  /** 강사가 정한 입장창(분). 모르면 기본값으로 본다. */
  entryWindowMinutes?: number | null
  /** 서버가 계산해 준 입장 개시 시각. 있으면 이쪽이 진실이다. */
  entryOpensAt?: string | null
}

/** 강사가 정한 입장창(분). 없으면 기본값. */
export function entryWindowMinutesOf(live: Pick<LiveEntryTiming, 'entryWindowMinutes'>) {
  return live.entryWindowMinutes ?? DEFAULT_ENTRY_WINDOW_MINUTES
}

/** 입장이 열리는 시각. 서버 계산값이 있으면 그대로, 없으면 예정 시각에서 입장창만큼 당긴다. */
export function entryOpensAtOf(live: LiveEntryTiming): Date | null {
  if (live.entryOpensAt) {
    const opensAt = new Date(live.entryOpensAt)
    if (Number.isFinite(opensAt.getTime())) return opensAt
  }
  if (!live.scheduledAt) return null
  const scheduledAt = new Date(live.scheduledAt).getTime()
  if (!Number.isFinite(scheduledAt)) return null
  return new Date(scheduledAt - entryWindowMinutesOf(live) * 60_000)
}

export function isLiveEntryOpen(live: LiveEntryTiming, now = Date.now()) {
  if (live.status === 'OPEN' || live.status === 'STARTING' || live.status === 'LIVE') return true
  if (live.status !== 'SCHEDULED') return false

  const opensAt = entryOpensAtOf(live)
  return opensAt !== null && now >= opensAt.getTime()
}
