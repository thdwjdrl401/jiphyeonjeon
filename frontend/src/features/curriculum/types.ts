import type { CurriculumOutlineLesson } from '@/features/lesson/types'
import type { CurriculumDetailAllowedAction, CurriculumDetailViewerContext } from '@/features/enrollment/types'

export type CurriculumLifecycleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export type CurriculumRelationship =
  | 'GUEST'
  | 'UNENROLLED_STUDENT'
  | 'PENDING_ENROLLMENT'
  | 'ENROLLED'
  | 'OWNER_INSTRUCTOR'
  | 'NON_OWNER_INSTRUCTOR'

export type CurriculumAllowedAction =
  | 'VIEW_DETAIL'
  | 'ENROLL'
  | 'CONTINUE_LEARNING'
  | 'MANAGE_CURRICULUM'
  | 'JOIN_LIVE'

export type CurriculumSort =
  | 'LATEST'
  | 'TITLE_ASC'
  | 'RECOMMENDED'

export interface CurriculumProgress {
  completedLessonCount: number
  totalLessonCount: number
  progressPercent: number
}

export interface CurriculumCardSummary {
  curriculumId: string
  title: string
  summary: string
  thumbnailUrl: string | null
  instructor: {
    instructorId: string
    displayName: string
  }
  lifecycleStatus: string
  period: {
    startsAt: string
    endsAt: string
  } | null
  sectionCount: number
  lessonCount: number
  viewerContext: {
    relationship: CurriculumRelationship
    // 목록 카드도 상세와 같은 viewerContext를 받는다 — 서버가 하나의 형태로 답한다.
    allowedActions: CurriculumDetailAllowedAction[]
    progress?: CurriculumProgress
  }
}

export interface CurriculumListResponse {
  items: CurriculumCardSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  hasNext: boolean
}

export interface CurriculumListQuery {
  q?: string
  featured?: boolean
  lifecycleStatus?: string
  sort?: CurriculumSort
  page?: number
  size?: number
}

export interface CurriculumDetailPeriod {
  startsAt: string
  endsAt: string
}

export type CurriculumEnrollmentPolicyType = 'IMMEDIATE' | 'APPROVAL_REQUIRED' | 'INVITATION_ONLY'

export interface CurriculumEnrollmentPolicy {
  type: CurriculumEnrollmentPolicyType
  status: string
  opensAt: string | null
  closesAt: string | null
}

export interface CurriculumInstructorProfile {
  instructorId: string
  displayName: string
  bio: string
  expertise: string[]
}

export interface CurriculumMaterial {
  materialId: string
  fileName: string
  fileSize: number
  embeddingStatus?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  keyTermStatus?: 'NOT_REQUESTED' | 'PENDING' | 'PROCESSING' | 'READY' | 'EMPTY' | 'FAILED'
  /**
   * 아직 서버에 올리지 않은 새 자료의 원본 파일(ADR-0042). 폼에서 선택한 순간에만 채워지고,
   * 저장 시 presigned 업로드→attach로 서버에 반영된 뒤에는 없는(persisted) 자료가 된다.
   * 조회·표시용 자료에는 없다.
   */
  file?: File
}

export interface CurriculumOutlineSection {
  sectionId: string
  title: string
  description: string | null
  order: number
  lessons: CurriculumOutlineLesson[]
}

export interface CurriculumDetailResponse {
  curriculumId: string
  title: string
  summary: string
  description: string
  thumbnailUrl: string | null
  lifecycleStatus: string
  period: CurriculumDetailPeriod | null
  materials: CurriculumMaterial[]
  enrollmentPolicy: CurriculumEnrollmentPolicy
  instructor: CurriculumInstructorProfile
  outline: CurriculumOutlineSection[]
  viewerContext: CurriculumDetailViewerContext
}
