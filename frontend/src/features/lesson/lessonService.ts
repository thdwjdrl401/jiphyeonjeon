import type { UserRole } from '@/features/auth/types'
import { getDemoCurriculumLessonNavigation, getDemoLesson } from '@/features/demo/demoData'
import { apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import type {
  CurriculumLiveSessionStatus,
  CurriculumReplayStatus,
  LessonStatus,
} from './types'

export interface LessonMaterialView {
  id: string
  name: string
  size: string
  status: string
}

export interface LessonDetailView {
  lessonId: string
  title: string
  description: string
  status: LessonStatus
  sectionId: string
  sectionTitle: string
  curriculumId: string
  curriculumTitle: string
  materials: LessonMaterialView[]
  liveSession: {
    sessionId: string
    status: CurriculumLiveSessionStatus
    scheduledAt: string | null
  } | null
  replayStatus: CurriculumReplayStatus
  learning: { completed: boolean; progressPercent: number } | null
}

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

export interface LessonNavigationView {
  curriculumId: string
  title: string
  sections: Array<{
    sectionId: string
    title: string
    lessons: Array<{ lessonId: string; title: string; order: number }>
  }>
}

export interface GetLessonRequest {
  lessonId: string
  role?: UserRole
  userId?: string
  curriculumId?: string
  sectionId?: string
}

export function getLesson(request: GetLessonRequest) {
  const instructorApiImplemented = request.role === 'INSTRUCTOR'
  return requestByDataSource<LessonDetailView>({
    mock: () => getDemoLesson(request.lessonId, request.userId),
    http: async () => {
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
    apiImplemented: instructorApiImplemented,
  })
}

export function getCurriculumLessonNavigation(curriculumId: string) {
  return requestByDataSource<LessonNavigationView>({
    mock: () => getDemoCurriculumLessonNavigation(curriculumId),
    http: async () => {
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
    apiImplemented: true,
  })
}

export interface SaveLessonRequest {
  sectionId: string
  lessonId?: string
  title: string
  description: string
  liveSessionId?: string
  scheduledAt?: string
  entryWindowMinutes?: number
  expectedDurationMinutes?: number
  materials: File[]
}

export async function saveLesson(request: SaveLessonRequest) {
  const lesson = await requestByDataSource<ApiLessonView>({
    mock: () => ({
      lessonId: request.lessonId ?? `lesson-mock-${Date.now()}`,
      sectionId: request.sectionId,
      title: request.title,
      description: request.description,
      status: 'DRAFT',
    }),
    http: async () => {
      if (request.lessonId) {
        const { data } = await apiClient.patch<ApiLessonView>(`/instructor/lessons/${request.lessonId}`, {
          title: request.title,
          description: request.description,
        })
        return data
      }
      const { data } = await apiClient.post<ApiLessonView>(`/instructor/sections/${request.sectionId}/lessons`, {
        title: request.title,
        description: request.description,
      })
      return data
    },
    apiImplemented: true,
  })

  if (request.scheduledAt) {
    await requestByDataSource({
      mock: () => undefined,
      http: async () => {
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
      },
      apiImplemented: true,
    })
  }

  if (request.materials.length > 0) {
    await requestByDataSource({
      mock: () => undefined,
      http: async () => {
        const body = new FormData()
        request.materials.forEach((file) => body.append('files', file))
        await apiClient.post(`/instructor/lessons/${lesson.lessonId}/materials`, body)
      },
      apiImplemented: false,
    })
  }
  return lesson
}

export function prepareLessonAi(lessonId: string) {
  return requestByDataSource({
    mock: () => new Promise<void>((resolve) => window.setTimeout(resolve, 700)),
    http: async () => {
      await apiClient.post(`/instructor/lessons/${lessonId}/ai-preparation`)
    },
    apiImplemented: false,
  })
}
