import { apiClient } from '@/shared/api/client'
import type {
  InstructorCurriculumItem,
  InstructorDashboardSummary,
  MyCurriculumsService,
  PageResponse,
  StudentDashboardSummary,
} from './myCurriculumsService.interface'

export const httpMyCurriculumsService = {
  async getInstructorCurriculums(query) {
    const { data } = await apiClient.get<PageResponse<InstructorCurriculumItem>>('/instructor/curriculums', {
      params: query,
    })
    return data
  },
  async getStudentDashboardSummary() {
    const { data } = await apiClient.get<StudentDashboardSummary>('/me/learning-summary')
    return data
  },
  async getInstructorDashboardSummary() {
    const { data } = await apiClient.get<InstructorDashboardSummary>('/instructor/dashboard-summary')
    return data
  },
} satisfies MyCurriculumsService
