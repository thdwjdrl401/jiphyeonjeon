import { apiClient } from '@/shared/api/client'
import { uploadAsset } from '@/shared/api/uploadAsset'
import type {
  CurriculumManagementSection,
  CurriculumManagementService,
  InstructorCurriculumResponse,
} from './curriculumManagementService.interface'

interface ApiSectionResponse {
  sectionId: string
  title: string
  description: string | null
  orderIndex: number
}

interface ApiLessonResponse {
  lessonId: string
  title: string
  status: string
}

export const httpCurriculumManagementService = {
  async uploadCurriculumThumbnail(file) {
    const asset = await uploadAsset(file, 'THUMBNAIL')
    return asset.assetId
  },
  async createCurriculum(request) {
    const { data } = await apiClient.post<{ curriculumId: string }>('/instructor/curriculums', {
      title: request.title,
      summary: request.summary,
      description: request.description,
      thumbnailAssetId: request.thumbnailAssetId,
    })
    return data
  },
  async getInstructorCurriculum(curriculumId) {
    const { data } = await apiClient.get<InstructorCurriculumResponse>(`/instructor/curriculums/${curriculumId}`)
    return { ...data, materials: data.materials ?? [], enrolleeCount: data.enrolleeCount ?? null }
  },
  async getCurriculumManagementStructure(curriculumId) {
    const { data: sections } = await apiClient.get<ApiSectionResponse[]>(`/instructor/curriculums/${curriculumId}/sections`)
    return Promise.all(sections.map(async (section): Promise<CurriculumManagementSection> => {
      const { data: lessons } = await apiClient.get<ApiLessonResponse[]>(`/instructor/sections/${section.sectionId}/lessons`)
      return {
        sectionId: section.sectionId,
        title: section.title,
        description: section.description ?? '',
        order: section.orderIndex + 1,
        lessons,
      }
    }))
  },
  async saveCurriculumManagement(request) {
    await apiClient.patch(`/instructor/curriculums/${request.curriculumId}`, request.info)
    await Promise.all(request.sections
      .filter((section) => !section.sectionId.startsWith('sec-new-'))
      .map((section) => apiClient.patch(`/instructor/sections/${section.sectionId}`, {
        title: section.title,
        description: section.description,
      })))

    const persistedSections = request.sections.filter((section) => !section.sectionId.startsWith('sec-new-'))
    if (persistedSections.length === request.sections.length) {
      await apiClient.put(`/instructor/curriculums/${request.curriculumId}/curriculum/order`, {
        baseVersion: request.structureVersion,
        sections: persistedSections.map((section) => ({
          sectionId: section.sectionId,
          lessonIds: section.lessons.map((lesson) => lesson.lessonId),
        })),
      })
    }

    await Promise.all(request.sections
      .filter((section) => section.sectionId.startsWith('sec-new-'))
      .map((section) => apiClient.post(`/instructor/curriculums/${request.curriculumId}/sections`, {
        title: section.title,
        description: section.description,
      })))

    await apiClient.put(`/instructor/curriculums/${request.curriculumId}/materials`, {
      materials: request.materials,
    })
  },
  async publishCurriculum(curriculumId) {
    await apiClient.post(`/instructor/curriculums/${curriculumId}/publish`)
  },
} satisfies CurriculumManagementService
