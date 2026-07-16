export type CourseRelationship =
  | 'GUEST'
  | 'UNENROLLED_STUDENT'
  | 'PENDING_ENROLLMENT'
  | 'ENROLLED'
  | 'OWNER_INSTRUCTOR'
  | 'NON_OWNER_INSTRUCTOR'

export type CourseAllowedAction =
  | 'VIEW_DETAIL'
  | 'ENROLL'
  | 'CONTINUE_LEARNING'
  | 'MANAGE_COURSE'
  | 'JOIN_LIVE'

export type CourseSort =
  | 'LATEST'
  | 'STARTING_SOON'
  | 'TITLE_ASC'
  | 'RECOMMENDED'

export interface CourseProgress {
  completedLessonCount: number
  totalLessonCount: number
  progressPercent: number
}

export interface CourseCardSummary {
  courseId: string
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
    relationship: CourseRelationship
    allowedActions: CourseAllowedAction[]
    progress?: CourseProgress
  }
}

export interface CourseListResponse {
  items: CourseCardSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  hasNext: boolean
}

export interface CourseListQuery {
  q?: string
  featured?: boolean
  lifecycleStatus?: string
  sort?: CourseSort
  page?: number
  size?: number
}
