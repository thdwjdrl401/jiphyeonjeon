import type { CurriculumService } from './curriculumService.interface'
import { getMockCurriculums } from './mockCurriculums'

export const mockCurriculumService = {
  getCurriculums: (query) => getMockCurriculums(query),
} satisfies CurriculumService
