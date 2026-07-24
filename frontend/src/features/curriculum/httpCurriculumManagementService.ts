import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
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
    // 자료 연결 API가 아직 없다(ADR-0023 MATERIAL은 CP3). 아래 네 번의 쓰기를 먼저 보내고
    // 마지막에 404를 맞으면 화면엔 "저장 실패"가 뜨는데 서버 데이터는 절반만 바뀐다.
    // 롤백할 방법이 없으므로 첫 쓰기 전에 막는다. 자료를 건드리지 않은 저장은 그대로 통과한다.
    if (request.materials.length > 0) {
      notImplemented(`PUT /instructor/curriculums/${request.curriculumId}/materials`)
    }

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
  },
  async publishCurriculum(curriculumId) {
    await apiClient.post(`/instructor/curriculums/${curriculumId}/publish`)
  },
} satisfies CurriculumManagementService
