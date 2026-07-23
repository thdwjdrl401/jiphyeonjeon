import type { AuthUser } from '@/features/auth/types'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'

export interface CurriculumDetailService {
  getCurriculumDetail: (curriculumId: string, viewer?: AuthUser) => Promise<CurriculumDetailResponse>
}
