import { peekMockUser } from '@/features/auth/mockAuth'
import {
  buildMockCurriculumOutline,
  getMockCurriculum,
  putMockCurriculum,
  updateMockCurriculumMaterials,
} from '@/features/demo/mockDatabase'
import { ApiError, apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import { uploadAsset } from '@/shared/api/uploadAsset'
import type { CurriculumMaterial } from './types'

export interface CreateCurriculumRequest {
  title: string
  summary: string
  description: string
  /** 미리 업로드해 둔 대표 이미지의 에셋 id. 없으면 null. */
  thumbnailAssetId: string | null
  /** 미리보기 URL. mock 저장소가 카드 이미지를 그릴 때만 쓰고 서버에는 보내지 않는다. */
  thumbnailPreviewUrl: string | null
  materials?: CurriculumMaterial[]
}

interface CreateCurriculumResponse {
  curriculumId: string
}

export interface InstructorCurriculumResponse {
  curriculumId: string
  title: string
  summary: string
  description: string
  thumbnailUrl: string | null
  lifecycleStatus: string
  sectionCount: number
  lessonCount: number
  publishedLessonCount: number
  structureVersion: number
  materials: CurriculumMaterial[]
  enrolleeCount: number | null
}

export interface CurriculumManagementLesson {
  lessonId: string
  title: string
  status: string
}

export interface CurriculumManagementSection {
  sectionId: string
  title: string
  description: string
  order: number
  lessons: CurriculumManagementLesson[]
}

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

export interface SaveCurriculumManagementRequest {
  curriculumId: string
  info: { title: string; summary: string; description: string }
  sections: CurriculumManagementSection[]
  materials: CurriculumMaterial[]
  structureVersion: number
}

/**
 * 대표 이미지를 올리고 커리큘럼에 붙일 에셋 id를 받는다.
 * mock 모드에는 올릴 곳이 없으므로 id 없이 미리보기만 유지한다.
 */
export function uploadCurriculumThumbnail(file: File) {
  return requestByDataSource<string | null>({
    mock: () => null,
    http: async () => {
      const asset = await uploadAsset(file, 'THUMBNAIL')
      return asset.assetId
    },
    apiImplemented: true,
  })
}

export function createCurriculum(request: CreateCurriculumRequest) {
  return requestByDataSource<CreateCurriculumResponse>({
    mock: () => {
      const user = peekMockUser()
      if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
      if (user.role !== 'INSTRUCTOR') {
        throw new ApiError('강사만 커리큘럼을 만들 수 있어요.', 403, 'INSTRUCTOR_ROLE_REQUIRED')
      }
      const curriculum = putMockCurriculum(user, {
        title: request.title,
        summary: request.summary,
        description: request.description,
        thumbnailUrl: request.thumbnailPreviewUrl,
        materials: request.materials,
      })
      return { curriculumId: curriculum.curriculumId }
    },
    http: async () => {
      // 자료(materials)는 커리큘럼에 연결하는 API가 아직 없어 보내지 않는다 —
      // 서버가 조용히 버리게 두는 대신, 붙일 곳이 생길 때 한 번에 맞춘다.
      const { data } = await apiClient.post<CreateCurriculumResponse>('/instructor/curriculums', {
        title: request.title,
        summary: request.summary,
        description: request.description,
        thumbnailAssetId: request.thumbnailAssetId,
      })
      return data
    },
    apiImplemented: true,
  })
}

export function getInstructorCurriculum(curriculumId: string) {
  return requestByDataSource<InstructorCurriculumResponse>({
    mock: () => {
      const curriculum = getMockCurriculum(curriculumId)
      if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없습니다.', 404, 'CURRICULUM_NOT_FOUND')
      return {
        curriculumId: curriculum.curriculumId,
        title: curriculum.title,
        summary: curriculum.summary,
        description: curriculum.description,
        thumbnailUrl: curriculum.thumbnailUrl,
        lifecycleStatus: curriculum.lifecycleStatus,
        sectionCount: curriculum.sectionCount,
        lessonCount: curriculum.lessonCount,
        publishedLessonCount: buildMockCurriculumOutline(curriculum)
          .flatMap((section) => section.lessons)
          .filter((lesson) => lesson.status === 'PUBLISHED').length,
        structureVersion: 0,
        materials: curriculum.materials,
        enrolleeCount: curriculum.enrolleeCount,
      }
    },
    http: async () => {
      const { data } = await apiClient.get<InstructorCurriculumResponse>(`/instructor/curriculums/${curriculumId}`)
      return { ...data, materials: data.materials ?? [], enrolleeCount: data.enrolleeCount ?? null }
    },
    apiImplemented: true,
  })
}

export function getCurriculumManagementStructure(curriculumId: string) {
  return requestByDataSource<CurriculumManagementSection[]>({
    mock: () => {
      const curriculum = getMockCurriculum(curriculumId)
      if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없습니다.', 404, 'CURRICULUM_NOT_FOUND')
      return buildMockCurriculumOutline(curriculum).map((section) => ({
        sectionId: section.sectionId,
        title: section.title,
        description: section.description ?? '',
        order: section.order,
        lessons: section.lessons.map((lesson) => ({
          lessonId: lesson.lessonId,
          title: lesson.title,
          status: lesson.status,
        })),
      }))
    },
    http: async () => {
      const { data: sections } = await apiClient.get<ApiSectionResponse[]>(`/instructor/curriculums/${curriculumId}/sections`)
      return Promise.all(sections.map(async (section) => {
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
    apiImplemented: true,
  })
}

export async function saveCurriculumManagement(request: SaveCurriculumManagementRequest) {
  const saveImplementedData = requestByDataSource({
    mock: () => undefined,
    http: async () => {
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
    },
    apiImplemented: true,
  })

  const createNewSections = Promise.all(request.sections
    .filter((section) => section.sectionId.startsWith('sec-new-'))
    .map((section) => requestByDataSource({
      mock: () => undefined,
      http: async () => {
        await apiClient.post(`/instructor/curriculums/${request.curriculumId}/sections`, {
          title: section.title,
          description: section.description,
        })
      },
      apiImplemented: true,
    })))

  const saveMaterials = requestByDataSource({
    mock: () => {
      updateMockCurriculumMaterials(request.curriculumId, request.materials)
    },
    http: async () => {
      await apiClient.put(`/instructor/curriculums/${request.curriculumId}/materials`, {
        materials: request.materials,
      })
    },
    apiImplemented: false,
  })

  await Promise.all([saveImplementedData, createNewSections, saveMaterials])
}

export function publishCurriculum(curriculumId: string) {
  return requestByDataSource({
    mock: () => undefined,
    http: async () => {
      await apiClient.post(`/instructor/curriculums/${curriculumId}/publish`)
    },
    apiImplemented: true,
  })
}
