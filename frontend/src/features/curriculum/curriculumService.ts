import { apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import type { AuthUser } from '@/features/auth/types'
import { getMockCurriculums } from './mockCurriculums'
import type { CurriculumCardSummary, CurriculumListQuery, CurriculumListResponse } from './types'
import { createFallbackViewerContext } from './viewerContext'

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

export async function getCurriculums(query: CurriculumListQuery, viewer?: AuthUser) {
  return requestByDataSource({
    mock: () => getMockCurriculums(query),
    http: async () => {
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
  })
}
