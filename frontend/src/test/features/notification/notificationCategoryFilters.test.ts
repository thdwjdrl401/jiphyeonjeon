import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_CATEGORY_LABEL,
  buildCategoryFilters,
} from '@/features/notification/notificationPresentation'
import type { NotificationType } from '@/features/notification/types'
import { emptyMessage } from '@/pages/NotificationsPage'

/** 라벨로 칩을 찾는다 — 순서에 기대지 않아 표가 늘어나도 이 테스트가 썩지 않는다. */
function chip(filters: ReturnType<typeof buildCategoryFilters>, label: string) {
  const found = filters.find((filter) => filter.label === label)
  if (!found) throw new Error(`${label} 칩이 없습니다`)
  return found
}

/**
 * 알림 종류 칩을 만드는 규칙.
 *
 * <p>지키려는 것은 넷이다 — <b>모든 종류를 늘 만드는가</b>(받은 적 없는 종류도 흐리게 남겨 이 화면에
 * 어떤 알림이 오는지 보여 준다), <b>건수를 정확히 세는가</b>(0이면 화면이 흐리게 낸다),
 * <b>목록 배지와 같은 말을 쓰는가</b>(라벨이 같은 종류는 한 칩), <b>순서가 흔들리지 않는가</b>
 * (새 알림이 올 때마다 칩이 자리를 바꾸면 누르려던 칩이 옮겨 간다).
 */
describe('알림 종류 칩', () => {
  const ALL_TYPES = Object.keys(NOTIFICATION_CATEGORY_LABEL) as NotificationType[]

  it('받은 알림이 없어도 모든 종류를 칩으로 만든다', () => {
    const filters = buildCategoryFilters([])

    expect(filters.length).toBeGreaterThan(0)
    expect(filters.flatMap((filter) => filter.types).sort()).toEqual([...ALL_TYPES].sort())
    // 하나도 받지 않았으므로 전부 0건 — 화면은 이걸 흐리게 그린다.
    filters.forEach((filter) => expect(filter.count).toBe(0))
  })

  it('받은 종류는 건수가 차고 나머지는 0으로 남는다', () => {
    const filters = buildCategoryFilters(['LIVE_STARTING_SOON', 'MATERIAL_PUBLISHED', 'LIVE_STARTING_SOON'])

    expect(chip(filters, '라이브 임박').count).toBe(2)
    expect(chip(filters, '학습 자료').count).toBe(1)
    expect(chip(filters, '다시보기').count).toBe(0)
  })

  /** 목록 배지가 신청과 거절을 모두 `수강 신청`이라 부른다 — 칩을 둘로 쪼개면 어느 칩이 그 배지인지 알 수 없다. */
  it('라벨이 같은 종류는 한 칩으로 묶고 건수를 합친다', () => {
    const filters = buildCategoryFilters(['ENROLLMENT_REQUESTED', 'ENROLLMENT_REJECTED'])
    const enrollment = chip(filters, '수강 신청')

    expect(enrollment.types).toEqual(['ENROLLMENT_REQUESTED', 'ENROLLMENT_REJECTED'])
    expect(enrollment.count).toBe(2)
    // 승인은 라벨이 달라 따로 남는다.
    expect(chip(filters, '수강 승인').types).toEqual(['ENROLLMENT_APPROVED'])
  })

  /** 들어온 순서가 아니라 라벨 표의 선언 순서를 따른다 — 새 알림이 칩 자리를 바꾸지 않게. */
  it('받은 순서와 무관하게 라벨 표의 순서로 놓는다', () => {
    const late = buildCategoryFilters(['VOD_PUBLISHED', 'ENROLLMENT_REQUESTED', 'LIVE_SCHEDULED'])
    const early = buildCategoryFilters(['LIVE_SCHEDULED', 'VOD_PUBLISHED', 'ENROLLMENT_REQUESTED'])

    expect(late.map((filter) => filter.label)).toEqual(early.map((filter) => filter.label))
    // 표의 첫 항목(수강 신청)이 언제나 맨 앞이다.
    expect(late[0].label).toBe('수강 신청')
  })

  it('칩 라벨은 겹치지 않고 모든 종류를 덮는다', () => {
    const filters = buildCategoryFilters(ALL_TYPES)

    expect(filters.flatMap((filter) => filter.types).sort()).toEqual([...ALL_TYPES].sort())
    expect(new Set(filters.map((filter) => filter.label)).size).toBe(filters.length)
    // 라벨이 겹치는 만큼 칩 수는 종류 수보다 적다(수강 신청 = 신청 + 거절).
    expect(filters.length).toBeLessThan(ALL_TYPES.length)
  })

  /**
   * 역할마다 칩 구성이 다르다. 강사에게 `학습 자료` 칩을 보여 주면 받을 일이 없는 종류를 계속
   * 확인하게 되고, 학생에게 `녹화 오류`는 아무 뜻이 없다.
   */
  describe('역할별 구성', () => {
    it('강사에게는 강사가 받는 종류만 준다', () => {
      const labels = buildCategoryFilters([], 'INSTRUCTOR').map((filter) => filter.label)

      expect(labels).toContain('수강 신청')
      expect(labels).toContain('녹화')
      expect(labels).toContain('녹화 오류')
      // 학생에게만 가는 종류는 없다.
      expect(labels).not.toContain('학습 자료')
      expect(labels).not.toContain('다시보기')
      expect(labels).not.toContain('수강 승인')
    })

    it('학생에게는 학생이 받는 종류만 준다', () => {
      const labels = buildCategoryFilters([], 'STUDENT').map((filter) => filter.label)

      expect(labels).toContain('수강 승인')
      expect(labels).toContain('학습 자료')
      expect(labels).toContain('다시보기')
      expect(labels).toContain('새 강의')
      // 강사에게만 가는 종류는 없다.
      expect(labels).not.toContain('녹화')
      expect(labels).not.toContain('녹화 오류')
    })

    /** 학생은 수업을 놓치지 않기 위해, 강사는 방송 준비 시간을 벌기 위해 받는다. */
    it('라이브 임박은 두 역할 모두에게 준다', () => {
      expect(buildCategoryFilters([], 'INSTRUCTOR').map((f) => f.label)).toContain('라이브 임박')
      expect(buildCategoryFilters([], 'STUDENT').map((f) => f.label)).toContain('라이브 임박')
    })

    it('역할을 모르면 모든 종류를 준다', () => {
      expect(buildCategoryFilters([]).flatMap((filter) => filter.types).sort()).toEqual([...ALL_TYPES].sort())
    })

    /**
     * 역할 표는 서버 규칙을 베낀 것이라 언제든 어긋날 수 있다. 그때도 <b>실제로 받은</b> 알림은
     * 칩으로 좁힐 수 있어야 한다 — 목록에 보이는데 필터가 없으면 방법이 사라진다.
     */
    it('역할 표에 없어도 실제로 받은 종류는 칩으로 만든다', () => {
      const filters = buildCategoryFilters(['MATERIAL_PUBLISHED'], 'INSTRUCTOR')
      const material = filters.find((filter) => filter.label === '학습 자료')

      expect(material).toBeDefined()
      expect(material!.count).toBe(1)
    })
  })
})

/**
 * 비었을 때의 문구. <b>무엇이 걸려서 비었는지</b>를 말해야 필터를 바꾸면 된다는 걸 알 수 있다 —
 * 읽음 축과 종류가 겹치므로 조합마다 문장이 달라진다.
 */
describe('알림 빈 목록 문구', () => {
  it('고른 종류를 함께 말한다', () => {
    expect(emptyMessage('UNREAD', '라이브 임박')).toBe('읽지 않은 라이브 임박 알림이 없습니다.')
    expect(emptyMessage('READ', '학습 자료')).toBe('읽은 학습 자료 알림이 없습니다.')
  })

  it('종류를 고르지 않았으면 읽음 축만 말한다', () => {
    expect(emptyMessage('UNREAD', null)).toBe('읽지 않은 알림이 없습니다.')
    expect(emptyMessage('READ', null)).toBe('읽은 알림이 없습니다.')
  })
})
