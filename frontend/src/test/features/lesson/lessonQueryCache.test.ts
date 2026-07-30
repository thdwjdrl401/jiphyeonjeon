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
})
