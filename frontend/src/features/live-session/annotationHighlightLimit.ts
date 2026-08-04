/**
 * 강조 캡처 상한(ADR-0074).
 *
 * <p><b>지금은 걸지 않는다.</b> 얼마가 적당한지 쓰기 전에는 알 수 없고, 없는 근거로 강사를 막으면
 * 기능을 못 쓰게 만든다. 대신 <b>자리를 만들어 둔다</b> — 나중에 상수만 바꾸면 켜진다. 켤 때가 되어
 * 판정 로직을 처음부터 찾아 넣으면, 그 급한 순간에 호출 지점을 빠뜨리기 쉽다.
 *
 * <p>막아야 할 이유는 둘이다. 캡처마다 비전 모델을 부르므로 <b>비용</b>이 들고, 이미지는 재처리를
 * 위해 계속 보관하므로 <b>저장소가 단조 증가</b>한다(AssetReaper는 업로드 실패분만 회수한다).
 */

/** 세션당 최대 캡처 수. 0 이하면 무제한. */
export const HIGHLIGHT_MAX_PER_SESSION = 0

/** 캡처 사이 최소 간격(ms). 0이면 제한 없음. */
export const HIGHLIGHT_MIN_INTERVAL_MS = 0

export interface HighlightLimitState {
  /** 이 세션에서 지금까지 잡은 캡처 수. */
  capturedCount: number
  /** 마지막 캡처 시각(ms). 아직 없으면 null. */
  lastCapturedAt: number | null
}

export type HighlightLimitVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'MAX_REACHED' | 'TOO_SOON'; message: string }

/**
 * 지금 캡처해도 되는가.
 *
 * <p>상한이 꺼져 있으면(기본) 항상 허용한다. 호출 지점은 켜기 전에도 이 함수를 거쳐야 한다 —
 * 그래야 켜는 순간 동작이 바뀌고, 그때 코드를 고칠 일이 없다.
 */
export function checkHighlightLimit(
  state: HighlightLimitState,
  now: number,
  max: number = HIGHLIGHT_MAX_PER_SESSION,
  minIntervalMs: number = HIGHLIGHT_MIN_INTERVAL_MS,
): HighlightLimitVerdict {
  if (max > 0 && state.capturedCount >= max) {
    return {
      allowed: false,
      reason: 'MAX_REACHED',
      message: `이 강의에서 강조는 ${max}개까지 남길 수 있습니다.`,
    }
  }
  if (minIntervalMs > 0 && state.lastCapturedAt !== null && now - state.lastCapturedAt < minIntervalMs) {
    return {
      allowed: false,
      reason: 'TOO_SOON',
      message: `강조는 ${Math.ceil(minIntervalMs / 1000)}초에 한 번 남길 수 있습니다.`,
    }
  }
  return { allowed: true }
}
