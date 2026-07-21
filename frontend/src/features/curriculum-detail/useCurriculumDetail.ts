import { useQuery } from '@tanstack/react-query'
import type { AuthUser } from '@/features/auth/types'
import { getCurriculumDetail } from './curriculumDetailService'

export function useCurriculumDetail(curriculumId: string, viewer?: AuthUser) {
  return useQuery({
    queryKey: ['curriculums', 'detail', curriculumId, viewer?.userId ?? 'guest'],
    queryFn: () => getCurriculumDetail(curriculumId, viewer),
    enabled: Boolean(curriculumId),
  })
}
