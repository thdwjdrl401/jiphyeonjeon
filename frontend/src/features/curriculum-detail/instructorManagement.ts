import type { CurriculumDetailResponse } from '@/features/curriculum/types'

export interface InstructorManagementView {
  isInstructor: boolean
}

/**
 * 관리 안내 카드는 강사 계정에게만 보인다.
 * 권한 판정은 viewerContext.relationship 그대로 쓰고, 카드에는 담당 여부 한 가지만 넘긴다.
 */
export function resolveInstructorManagement(detail: CurriculumDetailResponse): InstructorManagementView | null {
  switch (detail.viewerContext.relationship) {
    case 'OWNER_INSTRUCTOR':
      return { isInstructor: true }
    case 'NON_OWNER_INSTRUCTOR':
      return { isInstructor: false }
    default:
      return null
  }
}
