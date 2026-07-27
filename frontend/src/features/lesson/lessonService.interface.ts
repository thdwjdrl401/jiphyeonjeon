import type { UserRole } from '@/features/auth/types'
import type { CurriculumLiveSessionStatus, CurriculumReplayStatus, LessonStatus } from './types'

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

export interface LessonService {
  getLesson: (request: GetLessonRequest) => Promise<LessonDetailView>
  getCurriculumLessonNavigation: (curriculumId: string, role?: UserRole) => Promise<LessonNavigationView>
  saveLesson: (request: SaveLessonRequest) => Promise<{ lessonId: string; sectionId: string; title: string; description: string; status: LessonStatus }>
  deleteLessonMaterial: (lessonId: string, materialId: string) => Promise<void>
  prepareLessonAi: (lessonId: string) => Promise<void>
}
