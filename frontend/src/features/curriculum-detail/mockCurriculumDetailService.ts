import type { CurriculumDetailService } from './curriculumDetailService.interface'
import { getMockCurriculumDetail } from './mockCurriculumDetails'

export const mockCurriculumDetailService = {
  getCurriculumDetail: (curriculumId, viewer) => getMockCurriculumDetail(curriculumId, viewer),
} satisfies CurriculumDetailService
