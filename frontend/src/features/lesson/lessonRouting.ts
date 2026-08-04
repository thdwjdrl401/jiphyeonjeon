import { instructorPaths, studentPaths } from '@/app/router/paths'
import type { UserRole } from '@/features/auth/types'
import type { LessonAccessDestination } from './types'

/**
 * 강의 상세의 자료 영역 anchor. 자료 전용 화면이 없어 상세 안의 특정 영역으로 데려가야 하는
 * 링크(자료 등록 알림)가 있으므로, id 문자열을 두 곳에서 각자 쓰지 않게 여기서 내보낸다.
 */
export const LESSON_MATERIALS_ANCHOR = 'lesson-materials'

interface LessonPathParams {
  curriculumId: string
  sectionId: string
  lessonId: string
  destination: LessonAccessDestination | null
  sessionId?: string | null
  role: UserRole
  deliveryType?: 'LIVE' | 'RECORDED'
}

interface InstructorLessonEditPathParams {
  curriculumId: string
  sectionId: string
  lessonId: string
  deliveryType?: 'LIVE' | 'RECORDED'
}

export function resolveInstructorLessonEditPath({
  curriculumId,
  sectionId,
  lessonId,
  deliveryType = 'LIVE',
}: InstructorLessonEditPathParams) {
  return deliveryType === 'RECORDED'
    ? instructorPaths.editRecordedLesson(curriculumId, sectionId, lessonId)
    : instructorPaths.editLesson(curriculumId, sectionId, lessonId)
}

export function resolveLessonPath({
  curriculumId,
  sectionId,
  lessonId,
  destination,
  sessionId,
  role,
  deliveryType = 'LIVE',
}: LessonPathParams) {
  const lessonPath = role === 'INSTRUCTOR'
    ? deliveryType === 'RECORDED'
      ? instructorPaths.recordedLesson(curriculumId, sectionId, lessonId)
      : instructorPaths.lesson(curriculumId, sectionId, lessonId)
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
    case 'RECORDED_VOD':
      return role === 'INSTRUCTOR'
        ? instructorPaths.recordedLesson(curriculumId, sectionId, lessonId)
        : studentPaths.recorded(lessonId)
    case 'LESSON_DETAIL':
    default:
      return lessonPath
  }
}
