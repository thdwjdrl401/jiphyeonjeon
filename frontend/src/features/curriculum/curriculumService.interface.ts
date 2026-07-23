import type { AuthUser } from '@/features/auth/types'
import type { CurriculumListQuery, CurriculumListResponse } from './types'

export interface CurriculumService {
  getCurriculums: (query: CurriculumListQuery, viewer?: AuthUser) => Promise<CurriculumListResponse>
}
