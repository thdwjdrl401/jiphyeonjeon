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
    // 자료 연결 API가 아직 없다(ADR-0023 MATERIAL은 CP3). 아래 쓰기를 먼저 보내고 뒤에서 404를 맞으면
    // 화면엔 "저장 실패"가 뜨는데 서버 데이터는 절반만 바뀐다. 롤백할 방법이 없으므로 첫 쓰기 전에 막는다.
    if (request.materials.length > 0) {
      notImplemented(`PUT /instructor/curriculums/${request.curriculumId}/materials`)
    }

    await apiClient.patch(`/instructor/curriculums/${request.curriculumId}`, request.info)

    // 기존 섹션은 제목·설명만 갱신(순서는 아래 order PUT이 담당).
    await Promise.all(request.sections
      .filter((section) => !section.sectionId.startsWith('sec-new-'))
      .map((section) => apiClient.patch(`/instructor/sections/${section.sectionId}`, {
        title: section.title,
        description: section.description,
      })))

    // 새 섹션을 '순서 PUT 전에' 만들어 실제 id를 확보한다. 그래야 새 섹션도 순서에 포함할 수 있다
    // (예전엔 순서 PUT을 통째로 스킵해 새 섹션이 있으면 순서변경이 저장되지 않았다).
    const sectionIdMap: Record<string, string> = {}
    for (const section of request.sections.filter((s) => s.sectionId.startsWith('sec-new-'))) {
      const { data } = await apiClient.post<ApiSectionResponse>(
        `/instructor/curriculums/${request.curriculumId}/sections`,
        { title: section.title, description: section.description },
      )
      sectionIdMap[section.sectionId] = data.sectionId
    }

    // 섹션을 새로 만들었으면 그 과정에서 structureVersion이 올라갔으므로 최신 값을 다시 읽는다.
    // (안 만들었으면 사용자가 마지막으로 본 버전으로 CAS — 동시 편집 감지를 유지.)
    let baseVersion = request.structureVersion
    if (Object.keys(sectionIdMap).length > 0) {
      const { data } = await apiClient.get<{ structureVersion: number }>(`/instructor/curriculums/${request.curriculumId}`)
      baseVersion = data.structureVersion
    }

    // 모든 섹션(기존 + 새로 만든 것)을 사용자가 배치한 순서로 한 번에 저장한다.
    const { data: order } = await apiClient.put<{ structureVersion: number }>(
      `/instructor/curriculums/${request.curriculumId}/curriculum/order`,
      {
        baseVersion,
        sections: request.sections.map((section) => ({
          sectionId: sectionIdMap[section.sectionId] ?? section.sectionId,
          lessonIds: section.lessons.map((lesson) => lesson.lessonId),
        })),
      },
    )

    return { structureVersion: order.structureVersion, sectionIdMap }
  },
  async publishCurriculum(curriculumId) {
    await apiClient.post(`/instructor/curriculums/${curriculumId}/publish`)
  },
} satisfies CurriculumManagementService
