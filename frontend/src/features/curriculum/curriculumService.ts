import type { AuthUser } from '@/features/auth/types'
import { selectDataSource } from '@/shared/api/dataSource'
import { httpCurriculumService } from './httpCurriculumService'
import { mockCurriculumService } from './mockCurriculumService'
import type { CurriculumListQuery } from './types'
import type { CurriculumService } from './curriculumService.interface'

const curriculumService = selectDataSource<CurriculumService>(mockCurriculumService, httpCurriculumService)

export function getCurriculums(query: CurriculumListQuery, viewer?: AuthUser) {
  return curriculumService.getCurriculums(query, viewer)
}

export type { CurriculumService } from './curriculumService.interface'
