import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'

/**
 * 강의실에 들어와 있지만 강사가 아직 시작하지 않은 상태.
 *
 * <p>입장창은 예정 시각을 기준으로 <b>시계가 연다</b> — 강사가 여는 것이 아니다(`isLiveEntryOpen`).
 * 그래서 "들어올 수 있다"와 "강의가 시작됐다"는 별개이고, 그 사이 구간에 이름이 필요하다.
 *
 * <p>`STARTING`도 포함한다. 시작 게이트(STT dispatch·Egress·마이크 확인)는 수 초가 걸리고 그동안
 * 재생할 것이 아직 없다 — 기다림의 성격만 다르므로 문구를 갈라 쓴다.
 *
 * <p>`OPEN`은 이름과 달리 "문 열림"이 아니라 <b>시작하다 실패해 되돌아온</b> 상태다
 * (`LiveStartTransitions`가 실패 시 여기로 돌린다). 시작 전인 것은 마찬가지라 같이 묶는다.
 *
 * <p>`CANCELLED`·`FAILED`는 여기 없다. 그쪽은 <b>기다려도 시작되지 않는다</b> — 같은 "곧 시작합니다"를
 * 보여 주면 거짓말이 된다. 지금은 그 둘이 강의실 앞(prejoin)에서 걸러진다.
 *
 * <p>서버의 같은 판정은 `LiveInteractionGuard.hasStarted`의 여집합이다 — 그쪽은 시작한 적 있는
 * 세 상태(LIVE·ENDING·ENDED)를 적는다.
 */
export function isPrestartStatus(status: CurriculumLiveSessionStatus | undefined): boolean {
  return status === 'DRAFT' || status === 'SCHEDULED' || status === 'OPEN' || status === 'STARTING'
}

/** 영상 자리의 제목. 잠긴 자리마다 같은 말을 쓰도록 한곳에 둔다. */
export function prestartHeadline(isStarting: boolean): string {
  return isStarting ? '강의를 시작하고 있습니다.' : '아직 강의가 시작되지 않았습니다.'
}

/**
 * 잠긴 이유 한 줄.
 *
 * <p>두 문장 모두 <b>"자동으로"</b>를 말한다. 이 안내의 목적은 기다리라는 것이 아니라 <b>새로고침하지
 * 않아도 된다</b>는 것이다 — 시작 신호(`session.started`)를 받으면 화면이 스스로 넘어간다.
 */
export function prestartNotice(isStarting: boolean): string {
  return isStarting
    ? '강사가 시작을 눌렀습니다. 준비가 끝나면 자동으로 재생됩니다.'
    : '강사가 강의를 시작하면 자동으로 재생됩니다. 새로고침하지 않아도 됩니다.'
}

const scheduledAtFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** 예정 시각 표시. 값이 없거나 해석할 수 없으면 `null` — 모르는 것을 지어내지 않는다. */
export function formatScheduledAt(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null
  const at = new Date(scheduledAt)
  return Number.isFinite(at.getTime()) ? scheduledAtFormatter.format(at) : null
}
