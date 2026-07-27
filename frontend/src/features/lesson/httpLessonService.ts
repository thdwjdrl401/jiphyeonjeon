import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import { uploadAsset } from '@/shared/api/uploadAsset'
import type { CurriculumLiveSessionStatus, CurriculumReplayStatus, LessonStatus } from './types'
import type { LessonDetailView, LessonMaterialView, LessonService } from './lessonService.interface'

interface ApiLessonMaterial {
  materialId: string
  fileName: string
  fileSize: number
  embeddingStatus?: string   // PENDING/PROCESSING/READY/FAILED (ADR-0036). 없으면 READY로 간주.
}

interface ApiLessonView {
  lessonId: string
  sectionId: string
  title: string
  description: string
  status: LessonStatus
  materials?: ApiLessonMaterial[]
}

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

// 서버 자료 응답은 {materialId, fileName, fileSize}뿐이라 status가 없다. 화면(LessonDetailPage)은
// material.status로 준비 여부를 표시하므로, 이미 연결된 자료는 READY로 채운다.
function toMaterialView(material: ApiLessonMaterial): LessonMaterialView {
  return {
    id: material.materialId,
    name: material.fileName,
    size: formatFileSize(material.fileSize),
    status: material.embeddingStatus ?? 'READY',   // 임베딩 상태를 그대로 노출(ADR-0036)
  }
}

interface ApiCurriculumDetail {
  curriculumId: string
  title: string
  outline: Array<{
    sectionId: string
    title: string
    lessons: Array<{
      lessonId: string
      title: string
      status: LessonStatus
      liveSession?: {
        sessionId: string
        liveSessionStatus?: CurriculumLiveSessionStatus
        status?: CurriculumLiveSessionStatus
        scheduledAt?: string | null
      } | null
      replayStatus?: CurriculumReplayStatus
      learning?: { completed: boolean; progressPercent: number } | null
    }>
  }>
}

export const httpLessonService = {
  async getLesson(request) {
    const endpoint = request.role === 'INSTRUCTOR'
      ? `/instructor/lessons/${request.lessonId}`
      : `/lessons/${request.lessonId}`
    const { data: lesson } = await apiClient.get<ApiLessonView>(endpoint)

    let curriculumTitle = ''
    let sectionTitle = ''
    let liveSession: LessonDetailView['liveSession'] = null
    let replayStatus: CurriculumReplayStatus = 'NOT_READY'
    let learning: LessonDetailView['learning'] = null
    if (request.curriculumId) {
      const { data: curriculum } = await apiClient.get<ApiCurriculumDetail>(`/curriculums/${request.curriculumId}`)
      curriculumTitle = curriculum.title
      const section = curriculum.outline.find((item) => item.sectionId === (request.sectionId ?? lesson.sectionId))
      const outlineLesson = section?.lessons.find((item) => item.lessonId === lesson.lessonId)
      sectionTitle = section?.title ?? ''
      const liveStatus = outlineLesson?.liveSession?.liveSessionStatus ?? outlineLesson?.liveSession?.status
      if (outlineLesson?.liveSession && liveStatus) {
        liveSession = {
          sessionId: outlineLesson.liveSession.sessionId,
          status: liveStatus,
          scheduledAt: outlineLesson.liveSession.scheduledAt ?? null,
        }
      }
      replayStatus = outlineLesson?.replayStatus ?? 'NOT_READY'
      learning = outlineLesson?.learning ?? null
    }
    return {
      lessonId: lesson.lessonId,
      title: lesson.title,
      description: lesson.description,
      status: lesson.status,
      sectionId: lesson.sectionId,
      sectionTitle,
      curriculumId: request.curriculumId ?? '',
      curriculumTitle,
      materials: (lesson.materials ?? []).map(toMaterialView),
      liveSession,
      replayStatus,
      learning,
    }
  },
  async getCurriculumLessonNavigation(curriculumId) {
    const { data } = await apiClient.get<ApiCurriculumDetail>(`/curriculums/${curriculumId}`)
    return {
      curriculumId: data.curriculumId,
      title: data.title,
      sections: data.outline.map((section) => ({
        sectionId: section.sectionId,
        title: section.title,
        lessons: section.lessons.map((lesson, index) => ({
          lessonId: lesson.lessonId,
          title: lesson.title,
          order: index + 1,
        })),
      })),
    }
  },
  async saveLesson(request) {
    let lesson: ApiLessonView
    if (request.lessonId) {
      const { data } = await apiClient.patch<ApiLessonView>(`/instructor/lessons/${request.lessonId}`, {
        title: request.title,
        description: request.description,
      })
      lesson = data
    } else {
      const { data } = await apiClient.post<ApiLessonView>(`/instructor/sections/${request.sectionId}/lessons`, {
        title: request.title,
        description: request.description,
      })
      lesson = data
    }

    if (request.scheduledAt) {
      if (request.liveSessionId) {
        await apiClient.patch(`/instructor/live-sessions/${request.liveSessionId}`, {
          scheduledAt: request.scheduledAt,
          entryWindowMinutes: request.entryWindowMinutes,
          expectedDurationMinutes: request.expectedDurationMinutes,
        })
      } else {
        await apiClient.post(`/instructor/lessons/${lesson.lessonId}/live-sessions`, {
          scheduledAt: request.scheduledAt,
          entryWindowMinutes: request.entryWindowMinutes,
          expectedDurationMinutes: request.expectedDurationMinutes,
        })
      }
    }

    // 각 자료를 presigned로 올리고(발급→PUT→complete) 레슨에 연결한다. 레슨은 이미 저장됐으므로
    // 어느 파일에서 멈췄는지 알려, 레슨은 저장됐고 자료만 부분 실패했음을 호출자가 알 수 있게 한다.
    for (const file of request.materials) {
      try {
        const asset = await uploadAsset(file, 'MATERIAL')
        await apiClient.post(`/instructor/lessons/${lesson.lessonId}/materials`, { assetId: asset.assetId })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`레슨은 저장됐지만 자료 "${file.name}" 업로드·연결에 실패했습니다. 이 자료만 다시 추가해 주세요. (${reason})`)
      }
    }

    return lesson
  },
  async deleteLessonMaterial(lessonId, materialId) {
    await apiClient.delete(`/instructor/lessons/${lessonId}/materials/${materialId}`)
  },
  // 자료 임베딩을 트리거하는 경로. 자료 업로드 자체가 없어 준비할 대상이 없다(CP3).
  async prepareLessonAi(lessonId) {
    return notImplemented(`POST /instructor/lessons/${lessonId}/ai-preparation`)
  },
} satisfies LessonService
