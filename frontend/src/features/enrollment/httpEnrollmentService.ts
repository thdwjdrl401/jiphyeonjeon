import type { CurriculumLifecycleStatus } from '@/features/curriculum/types'
import { apiClient } from '@/shared/api/client'
import type { EnrollmentService } from './enrollmentService.interface'
import type {
  EnrollResult,
  EnrollmentRosterResponse,
  StudentCurriculumItem,
} from './types'

interface ApiEnrollmentCurriculum {
  curriculumId: string
  title: string
  summary: string
  thumbnailUrl: string | null
  lifecycleStatus: CurriculumLifecycleStatus
  lessonCount: number
  instructor: { displayName: string }
  viewerContext?: {
    progress?: { completedLessonCount: number; totalLessonCount: number; progressPercent: number }
  }
}

interface ApiMyEnrollmentItem {
  enrollmentId: string
  curriculumId: string
  status: StudentCurriculumItem['enrollmentStatus']
  requestedAt: string
  enrolledAt: string | null
  curriculum: ApiEnrollmentCurriculum
}

async function postTransition(curriculumId: string, enrollmentId: string, action: string) {
  const { data } = await apiClient.post<EnrollResult>(
    `/instructor/curriculums/${curriculumId}/enrollments/${enrollmentId}/${action}`,
  )
  return data
}

export const httpEnrollmentService = {
  async apply(curriculumId) {
    const { data } = await apiClient.post<EnrollResult>(`/curriculums/${curriculumId}/enrollments`)
    return data
  },
  async cancel(curriculumId) {
    const { data } = await apiClient.delete<EnrollResult>(`/curriculums/${curriculumId}/enrollments/me`)
    return data
  },
  async getMyEnrollments() {
    const { data } = await apiClient.get<ApiMyEnrollmentItem[]>('/me/enrollments')
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
  async getInstructorRoster(curriculumId, query = {}) {
    const { data } = await apiClient.get<EnrollmentRosterResponse>(
      `/instructor/curriculums/${curriculumId}/enrollments`,
      { params: query },
    )
    return data
  },
  approve: (curriculumId, enrollmentId) => postTransition(curriculumId, enrollmentId, 'approve'),
  reject: (curriculumId, enrollmentId) => postTransition(curriculumId, enrollmentId, 'reject'),
  revoke: (curriculumId, enrollmentId) => postTransition(curriculumId, enrollmentId, 'revoke'),
} satisfies EnrollmentService
