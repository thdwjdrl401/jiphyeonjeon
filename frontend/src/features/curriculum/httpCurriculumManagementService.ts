import axios from 'axios'
import { apiClient } from '@/shared/api/client'
import { uploadAsset } from '@/shared/api/uploadAsset'
import type {
  CurriculumManagementSection,
  CurriculumManagementService,
  InstructorCurriculumResponse,
} from './curriculumManagementService.interface'
import type { CurriculumMaterial } from './types'

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
  deliveryType: 'LIVE' | 'RECORDED'
}

interface ApiCurriculumMaterial {
  materialId: string
  fileName: string
  fileSize: number
  embeddingStatus?: string
}

interface RecordedLessonCreated {
  lessonId: string
  recordedVideoId: string
  deliveryType: 'RECORDED'
  processingStatus: 'AWAITING_UPLOAD'
}

interface RecordedUploadTicket {
  assetId: string
  uploadUrl: string
  method: string
  headers: Record<string, string>
  expiresAt: string
}

interface RecordedProcessingAccepted {
  lessonId: string
  recordedVideoId: string
  jobId: string
  status: 'QUEUED'
}

/** API 자료 응답을 화면 모델로. embeddingStatus·file은 목록/표시에 쓰지 않으므로 옮기지 않는다. */
function toCurriculumMaterial(material: ApiCurriculumMaterial): CurriculumMaterial {
  return { materialId: material.materialId, fileName: material.fileName, fileSize: material.fileSize }
}

/** 서버에 저장된 커리큘럼 자료 목록(persisted, File 없음). 저장 후 로컬 상태 교체·삭제 diff의 기준. */
async function fetchCurriculumMaterials(curriculumId: string): Promise<CurriculumMaterial[]> {
  const { data } = await apiClient.get<InstructorCurriculumResponse>(`/instructor/curriculums/${curriculumId}`)
  return (data.materials ?? []).map((material) => toCurriculumMaterial(material as ApiCurriculumMaterial))
}

/**
 * 새로 선택한 자료(File 보유)를 presigned 업로드→attach로 커리큘럼에 연결한다(ADR-0042, 레슨과 동일 흐름).
 * 이미 저장된(File 없는) 자료는 건너뛴다. 어느 파일에서 멈췄는지 알려 부분 실패를 호출자가 알 수 있게 한다.
 */
async function attachNewCurriculumMaterials(curriculumId: string, materials: CurriculumMaterial[]): Promise<void> {
  for (const material of materials) {
    if (!material.file) continue
    try {
      const asset = await uploadAsset(material.file, 'MATERIAL')
      await apiClient.post(`/instructor/curriculums/${curriculumId}/materials`, { assetId: asset.assetId })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`자료 "${material.fileName}" 업로드·연결에 실패했습니다. 이 자료만 다시 추가해 주세요. (${reason})`)
    }
  }
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

    // 생성 API(POST /instructor/curriculums)는 기간을 받지 않는다. 기본 정보 수정 PATCH는 받으므로
    // 입력이 있을 때만 이어서 보낸다. 여기서 실패해도 초안은 이미 만들어졌으니 예외를 올리지 않는다
    // — 올리면 화면이 "생성 실패"로 보여 같은 커리큘럼을 또 만들게 된다.
    let periodSaved = true
    if (request.startsAt !== null || request.endsAt !== null) {
      try {
        await apiClient.patch(`/instructor/curriculums/${data.curriculumId}`, {
          startsAt: request.startsAt,
          endsAt: request.endsAt,
        })
      } catch {
        periodSaved = false
      }
    }

    // 선택한 강의 자료를 presigned 업로드→attach로 연결한다(ADR-0042). 초안은 이미 만들어졌으므로
    // 자료 실패도 예외로 올리지 않는다 — 커리큘럼 재생성을 유발하지 않게 하고, 자료는 관리 화면에서 다시 추가한다.
    try {
      await attachNewCurriculumMaterials(data.curriculumId, request.materials ?? [])
    } catch {
      // 자료 부분 실패는 관리 화면에서 복구한다. 생성 자체는 성공으로 본다.
    }

    return { curriculumId: data.curriculumId, periodSaved }
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

    // 커리큘럼-레벨 자료 동기화(ADR-0042). 구조가 저장된 뒤에 반영한다 — 자료는 개별 attach/detach라
    // 부분 실패해도 구조는 이미 일관되게 저장돼 있다(레슨 자료 흐름과 같은 정책). 서버의 현재 자료를
    // 기준으로, 사라진 persisted 자료는 삭제하고 새로 선택한(File 보유) 자료는 업로드·연결한다.
    const serverMaterials = await fetchCurriculumMaterials(request.curriculumId)
    const keptIds = new Set(request.materials.filter((m) => !m.file).map((m) => m.materialId))
    for (const stale of serverMaterials.filter((m) => !keptIds.has(m.materialId))) {
      await apiClient.delete(`/instructor/curriculums/${request.curriculumId}/materials/${stale.materialId}`)
    }
    await attachNewCurriculumMaterials(request.curriculumId, request.materials)

    return {
      structureVersion: order.structureVersion,
      sectionIdMap,
      // 저장 후 서버 진실을 다시 읽어 돌려준다 — 화면이 임시 id·File을 실제 persisted 자료로 교체한다.
      materials: await fetchCurriculumMaterials(request.curriculumId),
    }
  },
  async publishCurriculum(curriculumId) {
    await apiClient.post(`/instructor/curriculums/${curriculumId}/publish`)
  },
  async deleteCurriculum(curriculumId) {
    await apiClient.delete(`/instructor/curriculums/${curriculumId}`)
  },
  async deleteLesson(lessonId) {
    await apiClient.delete(`/instructor/lessons/${lessonId}`)
  },
  async deleteSection(sectionId) {
    await apiClient.delete(`/instructor/sections/${sectionId}`)
  },
  async uploadRecordedLesson(request) {
    const { data: recorded } = await apiClient.post<RecordedLessonCreated>(
      `/instructor/sections/${request.sectionId}/recorded-lessons`,
      {
        clientRequestId: request.clientRequestId,
        title: request.title,
        description: request.description,
      },
    )

    const contentType = request.videoFile.type || 'video/mp4'
    const { data: ticket } = await apiClient.post<RecordedUploadTicket>(
      `/instructor/recorded-lessons/${recorded.lessonId}/video/upload-requests`,
      {
        fileName: request.videoFile.name,
        contentType,
        fileSize: request.videoFile.size,
      },
    )

    // 대용량 MP4는 앱 API·세션 쿠키·CSRF 인터셉터를 거치지 않고 스토리지에 직접 PUT한다.
    await axios.request({
      url: ticket.uploadUrl,
      method: ticket.method,
      headers: ticket.headers,
      data: request.videoFile,
    })

    const { data: accepted } = await apiClient.post<RecordedProcessingAccepted>(
      `/instructor/recorded-lessons/${recorded.lessonId}/video/complete`,
      { assetId: ticket.assetId },
    )

    return {
      lessonId: accepted.lessonId,
      recordedVideoId: accepted.recordedVideoId,
      jobId: accepted.jobId,
      processingStatus: accepted.status,
    }
  },
} satisfies CurriculumManagementService
