import { describe, expect, it } from 'vitest'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import { resolvePrimaryAction } from './primaryAction'

function makeDetail(overrides: Partial<CurriculumDetailResponse['viewerContext']>): CurriculumDetailResponse {
  return {
    curriculumId: 'cur_test',
    title: '테스트 커리큘럼',
    summary: '',
    description: '',
    thumbnailUrl: null,
    lifecycleStatus: 'PUBLISHED',
    period: null,
    enrollmentPolicy: { type: 'APPROVAL_REQUIRED', status: 'OPEN', opensAt: null, closesAt: null },
    instructor: { instructorId: 'usr_1', displayName: '강사', bio: '', expertise: [] },
    outline: [
      {
        sectionId: 'sec_1',
        title: '1. 섹션 1',
        description: null,
        order: 1,
        lessons: [
          {
            lessonId: 'les_1',
            title: '1강',
            order: 1,
            lessonStatus: 'PUBLISHED',
            scheduledAt: null,
            durationMs: null,
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
  it('승인 대기 상태에서는 취소 가능 여부와 무관하게 상태 안내만 반환한다(취소는 관계 패널이 전담)', () => {
    const withCancel = makeDetail({ relationship: 'PENDING_ENROLLMENT', allowedActions: ['CANCEL_ENROLLMENT'] })
    const withoutCancel = makeDetail({ relationship: 'PENDING_ENROLLMENT', allowedActions: [] })

    expect(resolvePrimaryAction(withCancel, '/curriculums/cur_test')).toEqual({ kind: 'status', label: '승인 대기' })
    expect(resolvePrimaryAction(withoutCancel, '/curriculums/cur_test')).toEqual({ kind: 'status', label: '승인 대기' })
  })

  it('수강생인데 학습 기록이 없으면 첫 레슨으로 가는 수강하기 액션을 반환한다', () => {
    const detail = makeDetail({
      relationship: 'ENROLLED',
      allowedActions: ['VIEW_LESSON', 'CONTINUE_LEARNING'],
      progress: { completedLessonCount: 0, totalLessonCount: 1, progressPercent: 0, lastLearning: null },
    })

    expect(resolvePrimaryAction(detail, '/curriculums/cur_test')).toEqual({
      kind: 'link',
      label: '수강하기',
      to: '/curriculums/cur_test/lessons/les_1',
    })
  })

  it('수강생인데 이전 학습 기록이 있으면 이어보기 액션을 반환한다', () => {
    const detail = makeDetail({
      relationship: 'ENROLLED',
      allowedActions: ['VIEW_LESSON', 'CONTINUE_LEARNING'],
      progress: {
        completedLessonCount: 3,
        totalLessonCount: 10,
        progressPercent: 30,
        lastLearning: { lessonId: 'les_3', sessionMs: 1000 },
      },
    })

    expect(resolvePrimaryAction(detail, '/curriculums/cur_test')).toEqual({
      kind: 'link',
      label: '이어보기',
      to: '/curriculums/cur_test/lessons/les_3',
    })
  })
})
