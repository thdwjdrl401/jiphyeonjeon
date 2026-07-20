import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { AuthUser } from '@/features/auth/types'
import { getCurriculums } from './curriculumService'
import type { CurriculumListQuery } from './types'

export function useCurriculums(query: CurriculumListQuery, viewer?: AuthUser) {
  return useQuery({
    queryKey: ['curriculums', query, viewer?.userId ?? 'guest'],
    queryFn: () => getCurriculums(query, viewer),
    placeholderData: keepPreviousData,
  })
}
