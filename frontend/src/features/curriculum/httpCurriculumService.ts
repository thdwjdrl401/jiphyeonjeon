import { apiClient } from '@/shared/api/client'
import { createFallbackViewerContext } from './viewerContext'
import type { CurriculumCardSummary, CurriculumListQuery, CurriculumListResponse } from './types'
import type { CurriculumService } from './curriculumService.interface'

type CurriculumApiCardSummary = Omit<CurriculumCardSummary, 'viewerContext'> &
  Partial<Pick<CurriculumCardSummary, 'viewerContext'>>

type CurriculumApiListResponse = Omit<CurriculumListResponse, 'items'> & {
  items: CurriculumApiCardSummary[]
}

function toApiQuery(query: CurriculumListQuery) {
  return {
    q: query.q,
    sort: query.sort === 'TITLE_ASC' ? 'TITLE_ASC' : 'LATEST',
    page: query.page,
    size: query.size,
  }
}

export const httpCurriculumService = {
  async getCurriculums(query, viewer) {
    const { data } = await apiClient.get<CurriculumApiListResponse>('/curriculums', {
      params: toApiQuery(query),
    })
    const fallbackViewerContext = createFallbackViewerContext(viewer)
    return {
      ...data,
      items: data.items.map((curriculum) => ({
        ...curriculum,
        viewerContext: curriculum.viewerContext ?? {
          relationship: fallbackViewerContext.relationship,
          allowedActions: ['VIEW_DETAIL'],
        },
      })),
    }
  },
} satisfies CurriculumService
