import type { AuthUser } from '@/features/auth/types'
import type { CurriculumDetailViewerContext } from '@/features/enrollment/types'

export function createFallbackViewerContext(viewer?: AuthUser): CurriculumDetailViewerContext {
  const relationship = !viewer
    ? 'GUEST'
    : viewer.role === 'INSTRUCTOR'
      ? 'NON_OWNER_INSTRUCTOR'
      : 'UNENROLLED_STUDENT'

  return {
    relationship,
    allowedActions: ['VIEW_DETAIL'],
    enrollment: null,
    progress: null,
    nextLiveSession: null,
  }
}
