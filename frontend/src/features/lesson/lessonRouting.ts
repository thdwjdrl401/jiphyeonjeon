import type { LessonAccessDestination } from './types'

interface LessonPathParams {
  curriculumId: string
  sectionId: string
  lessonId: string
  destination: LessonAccessDestination | null
  sessionId?: string | null
}

export function resolveLessonPath({ curriculumId, sectionId, lessonId, destination, sessionId }: LessonPathParams) {
  switch (destination) {
    case 'LIVE_SESSION':
      return sessionId ? `/live-sessions/${sessionId}` : `/curriculums/${curriculumId}/sections/${sectionId}/lessons/${lessonId}`
    case 'LIVE_CLASSROOM':
      return sessionId ? `/live-sessions/${sessionId}/classroom` : `/curriculums/${curriculumId}/sections/${sectionId}/lessons/${lessonId}`
    case 'VOD':
      return `/lessons/${lessonId}/replay`
    case 'LESSON_DETAIL':
    default:
      return `/curriculums/${curriculumId}/sections/${sectionId}/lessons/${lessonId}`
  }
}
