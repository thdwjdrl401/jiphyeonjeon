import type {
  CurriculumAllowedAction,
  CurriculumLifecycleStatus,
  CurriculumProgress,
  CurriculumRelationship,
} from '@/features/curriculum/types'

export type CurriculumDetailAllowedAction =
  | CurriculumAllowedAction
  | 'LOGIN_TO_ENROLL'
  | 'CANCEL_ENROLLMENT'
  | 'VIEW_LESSON'
  | 'EDIT_LESSON'
  | 'OPEN_LIVE_SESSION'

/** 서버 `EnrollmentStatus`와 1:1. 신청 이후 강사 판정·철회까지 모두 이 축에 들어온다. */
export type EnrollmentStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'CANCELLED'

export interface CurriculumEnrollmentRecord {
  enrollmentId: string
  status: EnrollmentStatus
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

/**
 * 수강 신청·취소 응답(서버 `EnrollmentResponse`와 동일 형태).
 * 판정 시각은 `decidedAt`(승인·거절), 수강 확정 시각은 `enrolledAt`으로 나뉜다.
 * 현재 서버는 취소·제적 때 기존 시각을 그대로 유지한다.
 */
export interface EnrollResult {
  enrollmentId: string
  curriculumId: string
  userId: string
  status: EnrollmentStatus
  requestedAt: string
  decidedAt: string | null
  enrolledAt: string | null
}

export interface StudentCurriculumItem {
  enrollmentId: string
  enrollmentStatus: EnrollmentStatus
  curriculumId: string
  title: string
  summary: string
  thumbnailUrl: string | null
  lifecycleStatus: CurriculumLifecycleStatus
  instructor: string
  progress: number
  completedLessonCount: number
  lessonCount: number
}

export interface EnrollmentRosterStudent {
  userId: string
  displayName: string | null
  email: string | null
}

export interface EnrollmentRosterItem {
  enrollmentId: string
  student: EnrollmentRosterStudent
  status: EnrollmentStatus
  requestedAt: string
  decidedAt: string | null
  enrolledAt: string | null
  allowedTransitions: EnrollmentStatus[]
}

export interface EnrollmentStatusSummary {
  pending: number
  active: number
  rejected: number
  revoked: number
  cancelled: number
}

export interface EnrollmentRosterQuery {
  status?: EnrollmentStatus
  page?: number
  size?: number
}

export interface EnrollmentRosterResponse {
  summary: EnrollmentStatusSummary
  items: EnrollmentRosterItem[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  hasNext: boolean
}

export type InstructorEnrollmentAction = 'approve' | 'reject' | 'revoke'
