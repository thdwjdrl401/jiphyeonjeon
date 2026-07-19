import type { CourseAllowedAction, CourseProgress, CourseRelationship } from '@/features/curriculum/types'

export type CourseDetailAllowedAction =
  | CourseAllowedAction
  | 'LOGIN_TO_ENROLL'
  | 'CANCEL_ENROLLMENT'
  | 'VIEW_LESSON'
  | 'EDIT_LESSON'
  | 'OPEN_LIVE_SESSION'

export interface CourseEnrollmentRecord {
  enrollmentId: string
  status: 'ACTIVE' | 'PENDING'
  requestedAt: string
}

export interface CourseLastLearning {
  lessonId: string
  sessionMs: number
}

export interface CourseDetailProgress extends CourseProgress {
  lastLearning: CourseLastLearning | null
}

export interface CourseActionRestriction {
  action: CourseDetailAllowedAction
  reasonCode: string
}

export interface CourseDetailViewerContext {
  relationship: CourseRelationship
  allowedActions: CourseDetailAllowedAction[]
  enrollment: CourseEnrollmentRecord | null
  progress: CourseDetailProgress | null
  nextLiveSession: null
  actionRestrictions?: CourseActionRestriction[]
}

export interface EnrollResult {
  enrollmentId: string
  courseId: string
  status: 'ACTIVE' | 'PENDING'
  requestedAt: string
  approvedAt: string | null
}
