import type { CurriculumDetailResponse } from '@/features/curriculum/types'

export type PrimaryAction =
  | { kind: 'enrollmentStatus'; label: string; cancelLabel: string }
  | { kind: 'status'; label: string }
  | null

export function resolvePrimaryAction(detail: CurriculumDetailResponse): PrimaryAction {
  const { relationship } = detail.viewerContext

  // 강사(담당·비담당)의 관리·안내 동선은 InstructorManagementCard가 전담한다.
  if (relationship === 'ENROLLED') {
    return { kind: 'enrollmentStatus', label: '수강 중', cancelLabel: '수강 취소' }
  }

  return null
}
