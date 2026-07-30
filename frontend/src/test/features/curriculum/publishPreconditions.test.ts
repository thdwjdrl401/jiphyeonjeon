import { describe, expect, it } from 'vitest'
import { evaluatePublishReadiness } from '@/features/curriculum/publishPreconditions'

/**
 * 게시 선행 조건(ADR-0006). 문구는 서버(`CurriculumNotPublishableException`)와 **같은 문장**이어야
 * 한다 — 버튼 비활성 사유와 서버 거절 메시지가 갈리면 같은 상황을 두 가지로 설명하게 된다.
 * 여기서 문장을 그대로 못 박아 두고, 서버 쪽은 계약 테스트가 같은 문장을 검증한다.
 */
describe('커리큘럼 게시 선행 조건', () => {
  it('섹션과 강의가 모두 없으면 둘 다 추가하라고 안내한다', () => {
    expect(evaluatePublishReadiness(0, 0)).toEqual({
      canPublish: false,
      reason: '커리큘럼을 게시하려면 섹션과 강의를 각각 1개 이상 추가해주세요.',
    })
  })

  it('섹션이 없으면 섹션을 추가하라고 안내한다', () => {
    // 강의만 있고 섹션이 없는 조합은 실제로는 성립하지 않지만(강의는 섹션에 속한다),
    // 판정 함수가 두 조건을 독립적으로 다루는지 확인한다.
    expect(evaluatePublishReadiness(0, 3)).toMatchObject({
      canPublish: false,
      reason: '커리큘럼을 게시하려면 섹션을 1개 이상 추가해주세요.',
    })
  })

  it('섹션만 있고 강의가 없으면 강의를 추가하라고 안내한다', () => {
    expect(evaluatePublishReadiness(2, 0)).toEqual({
      canPublish: false,
      reason: '커리큘럼을 게시하려면 강의를 1개 이상 추가해주세요.',
    })
  })

  it('섹션 1개와 강의 1개면 게시할 수 있다', () => {
    expect(evaluatePublishReadiness(1, 1)).toEqual({ canPublish: true, reason: null })
  })

  it('강의는 커리큘럼 전체 기준이다 — 빈 섹션이 있어도 막지 않는다', () => {
    // 섹션 3개 중 한 곳에만 강의가 있어도 충족한다. 섹션마다 강의를 요구하지 않는다.
    expect(evaluatePublishReadiness(3, 1)).toEqual({ canPublish: true, reason: null })
  })
})
