import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import { resolveLessonPath } from '@/features/lesson/lessonRouting'

export type PrimaryAction =
  | { kind: 'link'; label: string; to: string }
  | { kind: 'enroll'; label: string }
  | { kind: 'status'; label: string }
  | null

function findLessonLocation(detail: CurriculumDetailResponse, lessonId: string) {
  for (const section of detail.outline) {
    const lesson = section.lessons.find((candidate) => candidate.lessonId === lessonId)
    if (lesson) return { sectionId: section.sectionId, lesson }
  }
  return null
}

function getLessonDetailPath(detail: CurriculumDetailResponse, lessonId: string) {
  const location = findLessonLocation(detail, lessonId)
  if (!location) return null
  return resolveLessonPath({
    curriculumId: detail.curriculumId,
    sectionId: location.sectionId,
    lessonId: location.lesson.lessonId,
    destination: 'LESSON_DETAIL',
  })
}

export function resolvePrimaryAction(detail: CurriculumDetailResponse, returnTo: string): PrimaryAction {
  const { relationship, allowedActions, progress, nextLiveSession } = detail.viewerContext

  if (relationship === 'OWNER_INSTRUCTOR') {
    return { kind: 'link', label: '관리하기', to: `/curriculums/${detail.curriculumId}/manage` }
  }

  if (relationship === 'ENROLLED') {
    if (allowedActions.includes('JOIN_LIVE') && nextLiveSession) {
      return { kind: 'link', label: '라이브 입장', to: `/curriculums/${detail.curriculumId}` }
    }
    const lastLearningPath = progress?.lastLearning
      ? getLessonDetailPath(detail, progress.lastLearning.lessonId)
      : null
    if (lastLearningPath) {
      return {
        kind: 'link',
        label: '이어보기',
        to: lastLearningPath,
      }
    }
    const firstSection = detail.outline.find((section) => section.lessons.length > 0)
    const firstLesson = firstSection?.lessons[0]
    if (firstSection && firstLesson) {
      return {
        kind: 'link',
        label: '수강하기',
        to: resolveLessonPath({
          curriculumId: detail.curriculumId,
          sectionId: firstSection.sectionId,
          lessonId: firstLesson.lessonId,
          destination: 'LESSON_DETAIL',
        }),
      }
    }
    return null
  }

  if (relationship === 'UNENROLLED_STUDENT' && allowedActions.includes('ENROLL')) {
    return { kind: 'enroll', label: '수강 신청하기' }
  }

  if (relationship === 'PENDING_ENROLLMENT') {
    return { kind: 'status', label: '승인 대기' }
  }

  if (relationship === 'GUEST') {
    return { kind: 'link', label: '로그인 후 수강하기', to: `/login?returnTo=${encodeURIComponent(returnTo)}` }
  }

  return null
}
