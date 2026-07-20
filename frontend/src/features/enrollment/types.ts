import type { CurriculumAllowedAction, CurriculumProgress, CurriculumRelationship } from '@/features/curriculum/types'

export type CurriculumDetailAllowedAction =
  | CurriculumAllowedAction
  | 'LOGIN_TO_ENROLL'
  | 'CANCEL_ENROLLMENT'
  | 'VIEW_LESSON'
  | 'EDIT_LESSON'
  | 'OPEN_LIVE_SESSION'

export interface CurriculumEnrollmentRecord {
  enrollmentId: string
  status: 'ACTIVE' | 'PENDING'
  requestedAt: string
}

export interface CurriculumLastLearning {
  lessonId: string
  sessionMs: number
}

export interface CurriculumDetailProgress extends CurriculumProgress {
  lastLearning: CurriculumLastLearning | null
}

export interface CurriculumActionRestriction {
  action: CurriculumDetailAllowedAction
  reasonCode: string
}

export interface CurriculumDetailViewerContext {
  relationship: CurriculumRelationship
  allowedActions: CurriculumDetailAllowedAction[]
  enrollment: CurriculumEnrollmentRecord | null
  progress: CurriculumDetailProgress | null
  nextLiveSession: null
  actionRestrictions?: CurriculumActionRestriction[]
}

export interface EnrollResult {
  enrollmentId: string
  curriculumId: string
  status: 'ACTIVE' | 'PENDING'
  requestedAt: string
  approvedAt: string | null
}
