import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type {
  InstructorCurriculumItem,
  MyCurriculumsService,
  PageResponse,
} from './myCurriculumsService.interface'

export const httpMyCurriculumsService = {
  async getInstructorCurriculums(query) {
    const { data } = await apiClient.get<PageResponse<InstructorCurriculumItem>>('/instructor/curriculums', {
      params: query,
    })
    return data
  },
  // 요약은 진도(learning) 집계가 있어야 나오는 값이라 learning 패키지 배선 전까지 서버에
  // 만들 수 없다(ADR-0024). 목록 자체는 위 조회와 /me/enrollments 로 이미 뜬다.
  async getStudentDashboardSummary() {
    return notImplemented('GET /me/learning-summary')
  },
  async getInstructorDashboardSummary() {
    return notImplemented('GET /instructor/dashboard-summary')
  },
} satisfies MyCurriculumsService
