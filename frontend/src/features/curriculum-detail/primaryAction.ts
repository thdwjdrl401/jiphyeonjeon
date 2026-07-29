import type { CurriculumDetailResponse } from '@/features/curriculum/types'

export type PrimaryAction =
  | { kind: 'link'; label: string; to: string }
  | { kind: 'enroll'; label: string }
  | { kind: 'enrollmentStatus'; label: string; cancelLabel: string }
  | { kind: 'status'; label: string }
  | null

export function resolvePrimaryAction(detail: CurriculumDetailResponse, returnTo: string): PrimaryAction {
  const { relationship, allowedActions } = detail.viewerContext

  // 강사(담당·비담당)의 관리·안내 동선은 InstructorManagementCard가 전담한다.
  if (relationship === 'ENROLLED') {
    return { kind: 'enrollmentStatus', label: '수강 중', cancelLabel: '수강 취소' }
  }

  if (relationship === 'UNENROLLED_STUDENT' && allowedActions.includes('ENROLL')) {
    return { kind: 'enroll', label: '수강 신청하기' }
  }

  if (relationship === 'PENDING_ENROLLMENT') {
    return { kind: 'enrollmentStatus', label: '승인 대기', cancelLabel: '수강 신청 취소' }
  }

  if (relationship === 'GUEST') {
    return { kind: 'link', label: '로그인 후 수강하기', to: `/login?returnTo=${encodeURIComponent(returnTo)}` }
  }

  return null
}
