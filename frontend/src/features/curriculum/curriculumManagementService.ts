import { peekMockUser } from '@/features/auth/mockAuth'
import { putMockCurriculum } from '@/features/demo/mockDatabase'
import { ApiError, apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import type { CurriculumMaterial } from './types'

export interface CreateCurriculumRequest {
  title: string
  summary: string
  description: string
  thumbnailUrl: string | null
  materials?: CurriculumMaterial[]
}

interface CreateCurriculumResponse {
  curriculumId: string
}

export function createCurriculum(request: CreateCurriculumRequest) {
  return requestByDataSource<CreateCurriculumResponse>({
    mock: () => {
      const user = peekMockUser()
      if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
      if (user.role !== 'INSTRUCTOR') {
        throw new ApiError('강사만 커리큘럼을 만들 수 있어요.', 403, 'INSTRUCTOR_ROLE_REQUIRED')
      }
      const curriculum = putMockCurriculum(user, request)
      return { curriculumId: curriculum.curriculumId }
    },
    http: async () => {
      const { data } = await apiClient.post<CreateCurriculumResponse>('/instructor/curriculums', {
        title: request.title,
        summary: request.summary,
        description: request.description,
      })
      return data
    },
  })
}
