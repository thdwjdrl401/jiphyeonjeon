import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type { CurriculumLiveSessionStatus, CurriculumReplayStatus, LessonStatus } from './types'
import type { LessonDetailView, LessonService } from './lessonService.interface'

interface ApiLessonView {
  lessonId: string
  sectionId: string
  title: string
  description: string
  status: LessonStatus
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
      materials: [],
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
    // 자료 업로드는 ADR-0023의 presigned 경로로 가야 하는데(지금 코드는 multipart), 서버는
    // kind=MATERIAL을 세 곳에서 막는다 — kind 게이트·5MiB 상한·이미지 MIME 화이트리스트.
    // 뒤의 둘은 kind를 보지 않아서 게이트 하나만 열어도 통과하지 못한다(CP3).
    // 레슨을 먼저 만들고 마지막에 실패하면 절반만 저장되므로 첫 쓰기 전에 막는다.
    if (request.materials.length > 0) {
      notImplemented('POST /instructor/lessons/{lessonId}/materials')
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

    return lesson
  },
  // 자료 임베딩을 트리거하는 경로. 자료 업로드 자체가 없어 준비할 대상이 없다(CP3).
  async prepareLessonAi(lessonId) {
    return notImplemented(`POST /instructor/lessons/${lessonId}/ai-preparation`)
  },
} satisfies LessonService
