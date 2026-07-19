import type { CourseDetailResponse } from '@/features/curriculum/types'

export type PrimaryAction =
  | { kind: 'link'; label: string; to: string }
  | { kind: 'enroll'; label: string }
  | { kind: 'status'; label: string }
  | null

export function resolvePrimaryAction(detail: CourseDetailResponse, returnTo: string): PrimaryAction {
  const { relationship, allowedActions, progress, nextLiveSession } = detail.viewerContext

  if (relationship === 'OWNER_INSTRUCTOR') {
    return { kind: 'link', label: '관리하기', to: `/curriculums/${detail.courseId}/manage` }
  }

  if (relationship === 'ENROLLED') {
    if (allowedActions.includes('JOIN_LIVE') && nextLiveSession) {
      return { kind: 'link', label: '라이브 입장', to: `/curriculums/${detail.courseId}` }
    }
    if (progress?.lastLearning) {
      return {
        kind: 'link',
        label: '이어보기',
        to: `/curriculums/${detail.courseId}/lessons/${progress.lastLearning.lessonId}`,
      }
    }
    const firstLesson = detail.outline[0]?.lessons[0]
    if (firstLesson) {
      return { kind: 'link', label: '수강하기', to: `/curriculums/${detail.courseId}/lessons/${firstLesson.lessonId}` }
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
