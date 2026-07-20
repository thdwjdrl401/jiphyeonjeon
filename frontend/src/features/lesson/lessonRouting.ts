import type { LessonAccessDestination } from './types'

export function resolveLessonPath(curriculumId: string, lessonId: string, destination: LessonAccessDestination | null) {
  switch (destination) {
    case 'LIVE_SESSION':
      return `/curriculums/${curriculumId}/live/${lessonId}`
    case 'LIVE_CLASSROOM':
      return `/curriculums/${curriculumId}/classroom/${lessonId}`
    case 'VOD':
      return `/curriculums/${curriculumId}/lessons/${lessonId}/vod`
    case 'LESSON_DETAIL':
    default:
      return `/curriculums/${curriculumId}/lessons/${lessonId}`
  }
}
