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
  keyTermStatus?: string
}

interface ApiLessonView {
  lessonId: string
  sectionId: string
  title: string
  description: string
  status: LessonStatus
  deliveryType?: 'LIVE' | 'RECORDED'
  materials?: ApiLessonMaterial[]
  // /lessons/{id}(수강생 조회)만 준다 — /instructor/lessons/{id}는 sectionId로 이미 커리큘럼 문맥이
  // 정해져 있어 응답에 없다. 다시보기(ReplayLessonPage)처럼 호출자가 curriculumId를 모르는 화면이
  // "강의 상세" 경로를 만들 때 이 값을 써야 한다(request.curriculumId에만 기대면 항상 빈 문자열이 된다).
  curriculumId?: string
  curriculumTitle?: string
  sectionTitle?: string
  // 강사 레슨 조회(/instructor/lessons/{id})만 함께 준다. 공개 카탈로그는
  // PUBLISHED 커리큘럼만 보이므로 강사 저작 읽기는 강사 권한 축을 쓴다(BE ADR).
  liveSession?: {
    sessionId: string
    status: CurriculumLiveSessionStatus
    scheduledAt?: string | null
    entryWindowMinutes?: number | null
    expectedDurationMinutes?: number | null
  } | null
}

interface ApiInstructorCurriculum {
  curriculumId: string
  title: string
}

interface ApiInstructorSection {
  sectionId: string
  title: string
  orderIndex: number
}

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

// 서버 자료 응답은 {materialId, fileName, fileSize}뿐이라 status가 없다. 화면(LessonDetailPage)은
// material.status로 준비 여부를 표시하므로, 이미 연결된 자료는 READY로 채운다.
function toMaterialView(material: ApiLessonMaterial): LessonMaterialView {
  const embeddingStatus = material.embeddingStatus ?? 'READY'
  const keyTermStatus = material.keyTermStatus ?? 'NOT_REQUESTED'
  return {
    id: material.materialId,
    name: material.fileName,
    size: formatFileSize(material.fileSize),
    status: embeddingStatus,
    embeddingStatus: embeddingStatus as LessonMaterialView['embeddingStatus'],
    keyTermStatus: keyTermStatus as LessonMaterialView['keyTermStatus'],
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
      deliveryType?: 'LIVE' | 'RECORDED'
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

/**
 * 강사 레슨 상세 — 커리큘럼이 DRAFT여도 보이도록 강사 엔드포인트로 읽는다.
 * liveSession은 레슨 응답이 직접 준다. 커리큘럼·섹션 제목은 강사 커리큘럼/섹션 조회로 채운다.
 * replayStatus·learning은 저작 화면에서 쓰지 않으므로 안전한 기본값(NOT_READY·null).
 */
async function getInstructorLesson(request: {
  lessonId: string
  curriculumId?: string
  sectionId?: string
}): Promise<LessonDetailView> {
  const { data: lesson } = await apiClient.get<ApiLessonView>(`/instructor/lessons/${request.lessonId}`)
  // 레슨 응답이 curriculumId를 준다(강사 상세도 수강생 상세와 마찬가지로). 다시보기처럼 호출자가
  // curriculumId를 모르고 부르는 화면도 있으므로 request 값을 우선하지 말고 응답을 신뢰한다 —
  // 그래야 "강의 상세" 링크가 /curriculums//sections/... 같은 빈 세그먼트로 깨지지 않는다.
  const curriculumId = lesson.curriculumId ?? request.curriculumId ?? ''

  let curriculumTitle = ''
  let sectionTitle = ''
  if (curriculumId) {
    const [{ data: curriculum }, { data: sections }] = await Promise.all([
      apiClient.get<ApiInstructorCurriculum>(`/instructor/curriculums/${curriculumId}`),
      apiClient.get<ApiInstructorSection[]>(`/instructor/curriculums/${curriculumId}/sections`),
    ])
    curriculumTitle = curriculum.title
    sectionTitle = sections.find((item) => item.sectionId === (request.sectionId ?? lesson.sectionId))?.title ?? ''
  }

  return {
    lessonId: lesson.lessonId,
    title: lesson.title,
    description: lesson.description,
    status: lesson.status,
    deliveryType: lesson.deliveryType ?? 'LIVE',
    sectionId: lesson.sectionId,
    sectionTitle,
    curriculumId,
    curriculumTitle,
    materials: (lesson.materials ?? []).map(toMaterialView),
    liveSession: lesson.liveSession
      ? {
          sessionId: lesson.liveSession.sessionId,
          status: lesson.liveSession.status,
          scheduledAt: lesson.liveSession.scheduledAt ?? null,
        }
      : null,
    replayStatus: 'NOT_READY',
    learning: null,
  }
}

export const httpLessonService = {
  async getLesson(request) {
    // 강사 저작(수정 폼·상세)은 공개 카탈로그로 읽지 않는다. 그 경로는
    // PUBLISHED 커리큘럼만 보이므로 강사 엔드포인트로 읽는다.
    if (request.role === 'INSTRUCTOR') {
      return getInstructorLesson(request)
    }

    const { data: lesson } = await apiClient.get<ApiLessonView>(`/lessons/${request.lessonId}`)
    // 레슨 응답이 이미 curriculumId를 준다(수강생 상세, LESSON-DETAIL-01). 다시보기처럼 호출자가
    // curriculumId를 모르고 부르는 화면도 있으므로 request 값을 우선하지 말고 응답을 신뢰한다 —
    // 그래야 "강의 상세" 링크가 /curriculums//sections/... 같은 빈 세그먼트로 깨지지 않는다.
    const curriculumId = lesson.curriculumId ?? request.curriculumId ?? ''

    let curriculumTitle = lesson.curriculumTitle ?? ''
    let sectionTitle = lesson.sectionTitle ?? ''
    let liveSession: LessonDetailView['liveSession'] = null
    let replayStatus: CurriculumReplayStatus = 'NOT_READY'
    let learning: LessonDetailView['learning'] = null
    if (curriculumId) {
      const { data: curriculum } = await apiClient.get<ApiCurriculumDetail>(`/curriculums/${curriculumId}`)
      curriculumTitle = curriculum.title
      const section = curriculum.outline.find((item) => item.sectionId === (request.sectionId ?? lesson.sectionId))
      const outlineLesson = section?.lessons.find((item) => item.lessonId === lesson.lessonId)
      sectionTitle = section?.title ?? sectionTitle
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
      deliveryType: lesson.deliveryType ?? 'LIVE',
      sectionId: lesson.sectionId,
      sectionTitle,
      curriculumId,
      curriculumTitle,
      materials: (lesson.materials ?? []).map(toMaterialView),
      liveSession,
      replayStatus,
      learning,
    }
  },
  async getCurriculumLessonNavigation(curriculumId, role) {
    // 강사 사이드바는 DRAFT 커리큘럼에서도 떠야 한다. 공개 카탈로그는 PUBLISHED-only라 404가 나므로
    // 강사는 강사 엔드포인트(제목 + 섹션 + 섹션별 레슨)로 읽는다.
    if (role === 'INSTRUCTOR') {
      const [{ data: curriculum }, { data: sections }] = await Promise.all([
        apiClient.get<ApiInstructorCurriculum>(`/instructor/curriculums/${curriculumId}`),
        apiClient.get<ApiInstructorSection[]>(`/instructor/curriculums/${curriculumId}/sections`),
      ])
      const ordered = [...sections].sort((a, b) => a.orderIndex - b.orderIndex)
      const sectionsWithLessons = await Promise.all(ordered.map(async (section) => {
        const { data: lessons } = await apiClient.get<ApiLessonView[]>(`/instructor/sections/${section.sectionId}/lessons`)
        return {
          sectionId: section.sectionId,
          title: section.title,
          lessons: lessons.map((lesson, index) => ({
            lessonId: lesson.lessonId,
            title: lesson.title,
            order: index + 1,
            deliveryType: lesson.deliveryType ?? 'LIVE',
          })),
        }
      }))
      return { curriculumId: curriculum.curriculumId, title: curriculum.title, sections: sectionsWithLessons }
    }

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
          deliveryType: lesson.deliveryType ?? 'LIVE',
        })),
      })),
    }
  },
  async saveLesson(request) {
    if (!request.lessonId && !request.scheduledAt) {
      throw new Error('강의를 생성하려면 라이브 예정 시작 시각을 입력해야 합니다.')
    }

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
