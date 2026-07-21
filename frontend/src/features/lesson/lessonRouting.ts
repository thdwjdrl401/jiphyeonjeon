import { instructorPaths, studentPaths } from '@/app/router/paths'
import type { UserRole } from '@/features/auth/types'
import type { LessonAccessDestination } from './types'

interface LessonPathParams {
  curriculumId: string
  sectionId: string
  lessonId: string
  destination: LessonAccessDestination | null
  sessionId?: string | null
  role: UserRole
}

export function resolveLessonPath({ curriculumId, sectionId, lessonId, destination, sessionId, role }: LessonPathParams) {
  const lessonPath = role === 'INSTRUCTOR'
    ? instructorPaths.lesson(curriculumId, sectionId, lessonId)
    : studentPaths.lesson(curriculumId, sectionId, lessonId)

  switch (destination) {
    case 'LIVE_SESSION':
      return lessonPath
    case 'LIVE_CLASSROOM':
      return sessionId
        ? role === 'INSTRUCTOR' ? instructorPaths.classroom(sessionId) : studentPaths.classroom(sessionId)
        : lessonPath
    case 'VOD':
      return role === 'INSTRUCTOR' ? instructorPaths.replay(lessonId) : studentPaths.replay(lessonId)
    case 'LESSON_DETAIL':
    default:
      return lessonPath
  }
}
