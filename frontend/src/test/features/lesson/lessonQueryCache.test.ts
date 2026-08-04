import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidateAfterLessonWrite } from '@/features/lesson/lessonQueryCache'

describe('lesson query cache invalidation', () => {
  it('invalidates curriculum detail for every viewer after a lesson write', async () => {
    const queryClient = new QueryClient()
    const targetCurriculumId = 'cur-1'
    const guestDetailKey = ['curriculums', 'detail', targetCurriculumId, 'guest'] as const
    const instructorDetailKey = ['curriculums', 'detail', targetCurriculumId, 'instructor-1'] as const
    const managementKey = ['curriculum-management', targetCurriculumId] as const
    const navigationKey = ['curriculum-lesson-navigation', targetCurriculumId, 'INSTRUCTOR'] as const
    const unrelatedManagementKey = ['curriculum-management', 'cur-2'] as const

    queryClient.setQueryData(guestDetailKey, { outline: [] })
    queryClient.setQueryData(instructorDetailKey, { outline: [] })
    queryClient.setQueryData(managementKey, { sections: [] })
    queryClient.setQueryData(navigationKey, { sections: [] })
    queryClient.setQueryData(unrelatedManagementKey, { sections: [] })

    await invalidateAfterLessonWrite(queryClient, targetCurriculumId)

    expect(queryClient.getQueryState(guestDetailKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(instructorDetailKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(managementKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(navigationKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(unrelatedManagementKey)?.isInvalidated).toBe(false)
  })

  it('lessonId가 있으면 녹화강의 상세와 수정 폼 캐시도 함께 무효화한다', async () => {
    const queryClient = new QueryClient()
    const recordedDetailKey = ['recorded-lesson', 'les-1', 'cur-1', 'sec-1'] as const
    const lessonFormKey = ['instructor-lesson-form', 'les-1'] as const
    const unrelatedRecordedKey = ['recorded-lesson', 'les-2', 'cur-1', 'sec-1'] as const
    queryClient.setQueryData(recordedDetailKey, { title: '수정 전' })
    queryClient.setQueryData(lessonFormKey, { title: '수정 전' })
    queryClient.setQueryData(unrelatedRecordedKey, { title: '다른 강의' })

    await invalidateAfterLessonWrite(queryClient, 'cur-1', 'les-1')

    expect(queryClient.getQueryState(recordedDetailKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(lessonFormKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(unrelatedRecordedKey)?.isInvalidated).toBe(false)
  })
})
