import { describe, expect, it } from 'vitest'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import { resolvePrimaryAction } from '@/features/curriculum-detail/primaryAction'

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
    outline: [
      {
        sectionId: 'sec-1',
        title: '1. 섹션 1',
        description: null,
        order: 1,
        lessons: [
          {
            lessonId: 'les-1',
            title: '1강',
            order: 1,
            status: 'PUBLISHED',
            deliveryType: 'LIVE',
            scheduledAt: null,
            durationMs: null,
            liveSession: null,
            replayStatus: 'NOT_READY',
            recordedPublicationStatus: null,
            access: { allowed: true, destination: 'LESSON_DETAIL', reasonCode: null },
            learning: null,
          },
        ],
      },
    ],
    viewerContext: {
      relationship: 'PENDING_ENROLLMENT',
      allowedActions: [],
      enrollment: null,
      progress: null,
      nextLiveSession: null,
      ...overrides,
    },
  }
}

describe('resolvePrimaryAction', () => {
  it('승인 대기 상태의 액션은 사이드바 카드에서 처리한다', () => {
    const withCancel = makeDetail({ relationship: 'PENDING_ENROLLMENT', allowedActions: ['CANCEL_ENROLLMENT'] })
    const withoutCancel = makeDetail({ relationship: 'PENDING_ENROLLMENT', allowedActions: [] })

    expect(resolvePrimaryAction(withCancel)).toBeNull()
    expect(resolvePrimaryAction(withoutCancel)).toBeNull()
  })

  it('수강생에게 학습 기록과 무관하게 수강 상태와 취소 액션을 반환한다', () => {
    const detail = makeDetail({
      relationship: 'ENROLLED',
      allowedActions: ['VIEW_LESSON', 'CONTINUE_LEARNING'],
      progress: { completedLessonCount: 0, totalLessonCount: 1, progressPercent: 0, lastLearning: null },
    })

    expect(resolvePrimaryAction(detail)).toEqual({
      kind: 'enrollmentStatus',
      label: '수강 중',
      cancelLabel: '수강 취소',
    })
  })

  it('비로그인 사용자에게는 상단 기본 액션을 표시하지 않는다', () => {
    const detail = makeDetail({ relationship: 'GUEST', allowedActions: [] })

    expect(resolvePrimaryAction(detail)).toBeNull()
  })

  it('미수강 학생의 수강 신청 액션은 사이드바 카드에서 처리한다', () => {
    const detail = makeDetail({ relationship: 'UNENROLLED_STUDENT', allowedActions: ['ENROLL'] })

    expect(resolvePrimaryAction(detail)).toBeNull()
  })
})
