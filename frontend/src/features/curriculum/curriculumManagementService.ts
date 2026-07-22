import { peekMockUser } from '@/features/auth/mockAuth'
import { putMockCurriculum } from '@/features/demo/mockDatabase'
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
  })
}
