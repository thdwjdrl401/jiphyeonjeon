import { apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import {
  getDemoInstructorCurriculums,
  getDemoPendingStudentCurriculums,
  getDemoStudentCurriculums,
  getDemoStudentLearningSummary,
  getDemoTodayInstructorLiveSession,
  getDemoTodayLiveSession,
} from '@/features/demo/demoData'

export type CurriculumLifecycleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
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

interface ApiEnrollmentCurriculum {
  curriculumId: string
  title: string
  summary: string
  thumbnailUrl: string | null
  lifecycleStatus: CurriculumLifecycleStatus
  lessonCount: number
  instructor: { displayName: string }
  viewerContext?: {
    progress?: {
      completedLessonCount: number
      totalLessonCount: number
      progressPercent: number
    }
  }
}

interface ApiEnrollmentItem {
  enrollmentId: string
  curriculumId: string
  status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED'
  requestedAt: string
  enrolledAt: string | null
  curriculum: ApiEnrollmentCurriculum
}

export interface StudentCurriculumItem {
  enrollmentId: string
  enrollmentStatus: ApiEnrollmentItem['status']
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

export function getInstructorCurriculums(query: InstructorCurriculumQuery, userId: string) {
  return requestByDataSource<PageResponse<InstructorCurriculumItem>>({
    mock: () => {
      let items = getDemoInstructorCurriculums(userId).map((item) => ({
        curriculumId: item.curriculumId,
        title: item.title,
        summary: item.summary,
        thumbnailUrl: item.thumbnailUrl,
        lifecycleStatus: item.lifecycleStatus as CurriculumLifecycleStatus,
        sectionCount: 0,
        lessonCount: item.lessonCount,
        publishedLessonCount: item.publishedLessonCount,
        nextLiveSession: item.nextSession === '일정 미정' ? null : {
          sessionId: `mock-session-${item.curriculumId}`,
          lessonId: '',
          lessonTitle: null,
          scheduledAt: item.nextSession,
          liveSessionStatus: 'SCHEDULED',
        },
      }))
      const search = query.q?.trim().toLocaleLowerCase('ko')
      if (search) items = items.filter((item) => item.title.toLocaleLowerCase('ko').includes(search))
      if (query.status) items = items.filter((item) => item.lifecycleStatus === query.status)
      if (query.sort === 'TITLE_ASC') items.sort((a, b) => a.title.localeCompare(b.title, 'ko'))
      const page = query.page ?? 0
      const size = query.size ?? 20
      const start = page * size
      return {
        items: items.slice(start, start + size),
        page,
        size,
        totalElements: items.length,
        totalPages: Math.ceil(items.length / size),
        hasNext: start + size < items.length,
      }
    },
    http: async () => {
      const { data } = await apiClient.get<PageResponse<InstructorCurriculumItem>>('/instructor/curriculums', {
        params: query,
      })
      return data
    },
    apiImplemented: true,
  })
}

export function getStudentCurriculums(userId: string) {
  return requestByDataSource<StudentCurriculumItem[]>({
    mock: () => {
      const active = getDemoStudentCurriculums(userId).map((item) => ({
        enrollmentId: `mock-enrollment-${item.curriculumId}`,
        enrollmentStatus: 'ACTIVE' as const,
        curriculumId: item.curriculumId,
        title: item.title,
        summary: item.summary,
        thumbnailUrl: item.thumbnailUrl,
        lifecycleStatus: item.lifecycleStatus as CurriculumLifecycleStatus,
        instructor: item.instructor,
        progress: item.progress,
        completedLessonCount: item.completedLessonCount,
        lessonCount: item.lessonCount,
      }))
      const pending = getDemoPendingStudentCurriculums(userId).map((item) => ({
        enrollmentId: `mock-enrollment-${item.curriculumId}`,
        enrollmentStatus: 'PENDING' as const,
        curriculumId: item.curriculumId,
        title: item.title,
        summary: item.summary,
        thumbnailUrl: item.thumbnailUrl,
        lifecycleStatus: 'PUBLISHED' as const,
        instructor: item.instructor,
        progress: 0,
        completedLessonCount: 0,
        lessonCount: 0,
      }))
      return [...active, ...pending]
    },
    http: async () => {
      const { data } = await apiClient.get<ApiEnrollmentItem[]>('/me/enrollments')
      return data.map((item) => {
        const progress = item.curriculum.viewerContext?.progress
        return {
          enrollmentId: item.enrollmentId,
          enrollmentStatus: item.status,
          curriculumId: item.curriculumId,
          title: item.curriculum.title,
          summary: item.curriculum.summary,
          thumbnailUrl: item.curriculum.thumbnailUrl,
          lifecycleStatus: item.curriculum.lifecycleStatus,
          instructor: item.curriculum.instructor.displayName,
          progress: progress?.progressPercent ?? 0,
          completedLessonCount: progress?.completedLessonCount ?? 0,
          lessonCount: progress?.totalLessonCount ?? item.curriculum.lessonCount,
        }
      })
    },
    apiImplemented: true,
  })
}

export function getStudentDashboardSummary(userId: string) {
  return requestByDataSource<StudentDashboardSummary>({
    mock: () => ({
      ...getDemoStudentLearningSummary(userId),
      todayLiveSession: getDemoTodayLiveSession(userId),
    }),
    http: async () => {
      const { data } = await apiClient.get<StudentDashboardSummary>('/me/learning-summary')
      return data
    },
    apiImplemented: false,
  })
}

export function getInstructorDashboardSummary(userId: string) {
  return requestByDataSource<InstructorDashboardSummary>({
    mock: () => {
      const curriculums = getDemoInstructorCurriculums(userId)
      return {
        totalCurriculumCount: curriculums.length,
        publishedCurriculumCount: curriculums.filter((item) => item.lifecycleStatus === 'PUBLISHED').length,
        upcomingLiveCount: curriculums.filter((item) => item.nextSession !== '일정 미정').length,
        totalEnrolleeCount: curriculums.reduce((sum, item) => sum + item.enrolleeCount, 0),
        todayLiveSession: getDemoTodayInstructorLiveSession(userId),
      }
    },
    http: async () => {
      const { data } = await apiClient.get<InstructorDashboardSummary>('/instructor/dashboard-summary')
      return data
    },
    apiImplemented: false,
  })
}
