import { apiClient } from '@/shared/api/client'
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

    if (request.materials.length > 0) {
      const body = new FormData()
      request.materials.forEach((file) => body.append('files', file))
      await apiClient.post(`/instructor/lessons/${lesson.lessonId}/materials`, body)
    }
    return lesson
  },
  async prepareLessonAi(lessonId) {
    await apiClient.post(`/instructor/lessons/${lessonId}/ai-preparation`)
  },
} satisfies LessonService
