import type { QueryClient } from '@tanstack/react-query'

/**
 * A lesson write changes every curriculum projection that contains that lesson.
 * Invalidate all viewer variants of the public detail as well as instructor views.
 */
export async function invalidateAfterLessonWrite(queryClient: QueryClient, curriculumId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] }),
    queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] }),
    queryClient.invalidateQueries({ queryKey: ['instructor-curriculum', curriculumId] }),
    queryClient.invalidateQueries({ queryKey: ['curriculums'] }),
  ])
}
