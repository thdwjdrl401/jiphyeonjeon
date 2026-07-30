/**
 * 커리큘럼 게시 선행 조건 — 섹션 1개 이상 AND 커리큘럼 전체 강의 1개 이상(ADR-0006).
 *
 * 강의는 <b>커리큘럼 전체</b> 기준이다. 섹션마다 강의가 있어야 하는 것이 아니라, 어느 한 섹션에라도
 * 강의가 있으면 충족한다.
 *
 * 문구는 서버(`CurriculumNotPublishableException`)와 **같은 문장**을 쓴다. 버튼 비활성 사유와
 * 서버 거절 메시지가 다르면 같은 상황을 두 가지로 설명하게 된다.
 *
 * 이 판정을 화면에서 하는 이유는 버튼을 미리 잠가 안내하기 위함이고, 서버가 같은 조건을 다시 본다 —
 * 버튼을 우회한 직접 호출과 낡은 캐시를 든 화면이 남기 때문이다.
 */

export interface CurriculumPublishReadiness {
  canPublish: boolean
  /** 게시할 수 없는 이유. 충족했으면 null. 버튼 tooltip과 인접 안내에 같은 문장을 쓴다. */
  reason: string | null
}

export function evaluatePublishReadiness(
  sectionCount: number,
  totalLessonCount: number,
): CurriculumPublishReadiness {
  const hasSection = sectionCount > 0
  const hasLesson = totalLessonCount > 0

  if (!hasSection && !hasLesson) {
    return { canPublish: false, reason: '커리큘럼을 게시하려면 섹션과 강의를 각각 1개 이상 추가해주세요.' }
  }
  if (!hasSection) {
    return { canPublish: false, reason: '커리큘럼을 게시하려면 섹션을 1개 이상 추가해주세요.' }
  }
  if (!hasLesson) {
    return { canPublish: false, reason: '커리큘럼을 게시하려면 강의를 1개 이상 추가해주세요.' }
  }
  return { canPublish: true, reason: null }
}
