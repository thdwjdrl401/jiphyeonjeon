import type { AuthUser } from '@/features/auth/types'
import { selectDataSource } from '@/shared/api/dataSource'
import { httpCurriculumDetailService } from './httpCurriculumDetailService'
import { mockCurriculumDetailService } from './mockCurriculumDetailService'
import type { CurriculumDetailService } from './curriculumDetailService.interface'

const curriculumDetailService = selectDataSource<CurriculumDetailService>(
  mockCurriculumDetailService,
  httpCurriculumDetailService,
)

export function getCurriculumDetail(curriculumId: string, viewer?: AuthUser) {
  return curriculumDetailService.getCurriculumDetail(curriculumId, viewer)
}

export type { CurriculumDetailService } from './curriculumDetailService.interface'
