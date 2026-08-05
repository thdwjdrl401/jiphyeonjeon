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

  /*
    자료를 올리거나 지운 뒤 수정 폼·강의 상세를 다시 열면 저장 전 목록이 30초(staleTime) 동안
    그대로 보였다 — 그 강의 자신을 읽는 키를 아무도 무효화하지 않았기 때문이다(ADR-0076).

    강의 종류(라이브/녹화)를 분기하지 않고 세 키를 모두 비운다. 없는 키를 비우는 건 무해하고,
    분기하면 새 종류가 생길 때 여기가 조용히 뒤처진다.
  */
  it('lessonId를 주면 그 강의를 읽는 수정 폼·라이브 상세·녹화 상세 쿼리도 무효화한다', async () => {
    const queryClient = new QueryClient()
    const formKey = ['instructor-lesson-form', 'lesson-1'] as const
    const detailKey = ['lesson', 'lesson-1', 'INSTRUCTOR', 'instructor-1', 'cur-1', 'sec-1'] as const
    const recordedDetailKey = ['recorded-lesson', 'lesson-1', 'cur-1', 'sec-1'] as const
    const otherLessonFormKey = ['instructor-lesson-form', 'lesson-2'] as const
    const otherLessonDetailKey = ['lesson', 'lesson-2', 'INSTRUCTOR', 'instructor-1', 'cur-1', 'sec-1'] as const
    const otherRecordedDetailKey = ['recorded-lesson', 'lesson-2', 'cur-1', 'sec-1'] as const

    queryClient.setQueryData(formKey, { materials: [] })
    queryClient.setQueryData(detailKey, { materials: [] })
    queryClient.setQueryData(recordedDetailKey, { title: '수정 전' })
    queryClient.setQueryData(otherLessonFormKey, { materials: [] })
    queryClient.setQueryData(otherLessonDetailKey, { materials: [] })
    queryClient.setQueryData(otherRecordedDetailKey, { title: '다른 강의' })

    await invalidateAfterLessonWrite(queryClient, 'cur-1', 'lesson-1')

    expect(queryClient.getQueryState(formKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(recordedDetailKey)?.isInvalidated).toBe(true)
    // 다른 강의는 건드리지 않는다 — 한 강의를 저장했다고 목록 전체를 다시 읽을 이유가 없다.
    expect(queryClient.getQueryState(otherLessonFormKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(otherLessonDetailKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(otherRecordedDetailKey)?.isInvalidated).toBe(false)
  })
})
