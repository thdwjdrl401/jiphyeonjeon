import { describe, expect, it } from 'vitest'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import { resolvePrimaryAction } from './primaryAction'

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
            scheduledAt: null,
            durationMs: null,
            liveSession: null,
            replayStatus: 'NOT_READY',
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
  it('승인 대기 상태에서는 상태 배지와 신청 취소 액션을 반환한다', () => {
    const withCancel = makeDetail({ relationship: 'PENDING_ENROLLMENT', allowedActions: ['CANCEL_ENROLLMENT'] })
    const withoutCancel = makeDetail({ relationship: 'PENDING_ENROLLMENT', allowedActions: [] })

    const expected = { kind: 'enrollmentStatus', label: '승인 대기', cancelLabel: '수강 신청 취소' }
    expect(resolvePrimaryAction(withCancel, '/curriculums/cur-test')).toEqual(expected)
    expect(resolvePrimaryAction(withoutCancel, '/curriculums/cur-test')).toEqual(expected)
  })

  it('수강생에게 학습 기록과 무관하게 수강 상태와 취소 액션을 반환한다', () => {
    const detail = makeDetail({
      relationship: 'ENROLLED',
      allowedActions: ['VIEW_LESSON', 'CONTINUE_LEARNING'],
      progress: { completedLessonCount: 0, totalLessonCount: 1, progressPercent: 0, lastLearning: null },
    })

    expect(resolvePrimaryAction(detail, '/curriculums/cur-test')).toEqual({
      kind: 'enrollmentStatus',
      label: '수강 중',
      cancelLabel: '수강 취소',
    })
  })
})
