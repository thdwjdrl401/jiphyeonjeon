import type { CurriculumLifecycleStatus } from './types'

export type InstructorCurriculumSort = 'LATEST' | 'TITLE_ASC'

export interface NextLiveSessionSummary {
  sessionId: string
  lessonId: string
  lessonTitle: string | null
  scheduledAt: string
  liveSessionStatus: string
}

export interface InstructorCurriculumItem {
  curriculumId: string
  title: string
  summary: string
  thumbnailUrl: string | null
  lifecycleStatus: CurriculumLifecycleStatus
  sectionCount: number
  lessonCount: number
  publishedLessonCount: number
  nextLiveSession: NextLiveSessionSummary | null
}

export interface PageResponse<T> {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  hasNext: boolean
}

export interface InstructorCurriculumQuery {
  q?: string
  status?: CurriculumLifecycleStatus
  sort?: InstructorCurriculumSort
  page?: number
  size?: number
}

export interface StudentLearningSummary {
  inProgressCurriculumCount: number
  completedCurriculumCount: number
  averageProgress: number
  completedLessonCount: number
}

export interface DashboardLiveSession {
  sessionId: string
  lessonId: string
  lessonTitle: string
  curriculumId: string
  curriculumTitle: string
  sectionId?: string
  scheduledAt: string | null
  liveSessionStatus: string
  durationMs?: number | null
}

export interface InstructorDashboardSummary {
  totalCurriculumCount: number
  publishedCurriculumCount: number
  upcomingLiveCount: number
  totalEnrolleeCount: number | null
  todayLiveSession: DashboardLiveSession | null
}

export interface StudentDashboardSummary extends StudentLearningSummary {
  todayLiveSession: DashboardLiveSession | null
}

export interface MyCurriculumsService {
  getInstructorCurriculums: (query: InstructorCurriculumQuery, userId: string) => Promise<PageResponse<InstructorCurriculumItem>>
  getStudentDashboardSummary: (userId: string) => Promise<StudentDashboardSummary>
  getInstructorDashboardSummary: (userId: string) => Promise<InstructorDashboardSummary>
}
