import type { LessonAccessDestination } from './types'

export function resolveLessonPath(courseId: string, lessonId: string, destination: LessonAccessDestination | null) {
  switch (destination) {
    case 'LIVE_SESSION':
      return `/curriculums/${courseId}/live/${lessonId}`
    case 'LIVE_CLASSROOM':
      return `/curriculums/${courseId}/classroom/${lessonId}`
    case 'VOD':
      return `/curriculums/${courseId}/lessons/${lessonId}/vod`
    case 'LESSON_DETAIL':
    default:
      return `/curriculums/${courseId}/lessons/${lessonId}`
  }
}
