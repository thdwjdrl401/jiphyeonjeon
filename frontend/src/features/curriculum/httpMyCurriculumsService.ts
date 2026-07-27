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
  // 학생 요약은 learning 배선(ADR-0033) 이후 서버 집계로 채운다(inProgress/completed 커리큘럼 수·
  // 평균 진도·완료 레슨 수·다음 라이브).
  async getStudentDashboardSummary() {
    const { data } = await apiClient.get<StudentDashboardSummary>('/me/learning-summary')
    return data
  },
  async getInstructorDashboardSummary() {
    const { data } = await apiClient.get<InstructorDashboardSummary>('/instructor/dashboard-summary')
    return data
  },
} satisfies MyCurriculumsService
