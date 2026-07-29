import { describe, expect, it } from 'vitest'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import { resolveInstructorManagement } from '@/features/curriculum-detail/instructorManagement'

function makeDetail(overrides: Partial<CurriculumDetailResponse['viewerContext']>): CurriculumDetailResponse {
  return {
    curriculumId: 'cur-test',
    title: '테스트 커리큘럼',
    summary: '',
    description: '',
    thumbnailUrl: null,
    lifecycleStatus: 'PUBLISHED',
    period: null,
    materials: [],
    enrollmentPolicy: { type: 'APPROVAL_REQUIRED', status: 'OPEN', opensAt: null, closesAt: null },
    instructor: { instructorId: 'usr_1', displayName: '강사', bio: '', expertise: [] },
    outline: [],
    viewerContext: {
      relationship: 'GUEST',
      allowedActions: [],
      enrollment: null,
      progress: null,
      nextLiveSession: null,
      ...overrides,
    },
  }
}

describe('resolveInstructorManagement', () => {
  it('담당 강사에게는 관리 가능한 카드를 노출한다', () => {
    const detail = makeDetail({ relationship: 'OWNER_INSTRUCTOR', allowedActions: ['MANAGE_CURRICULUM', 'EDIT_LESSON'] })

    expect(resolveInstructorManagement(detail)).toEqual({ isInstructor: true })
  })

  it('담당하지 않는 강사에게는 안내 전용 카드를 노출한다', () => {
    const detail = makeDetail({ relationship: 'NON_OWNER_INSTRUCTOR', allowedActions: [] })

    expect(resolveInstructorManagement(detail)).toEqual({ isInstructor: false })
  })

  it('강사가 아닌 뷰어에게는 카드를 노출하지 않는다', () => {
    for (const relationship of ['GUEST', 'UNENROLLED_STUDENT', 'PENDING_ENROLLMENT', 'ENROLLED'] as const) {
      expect(resolveInstructorManagement(makeDetail({ relationship }))).toBeNull()
    }
  })
})
