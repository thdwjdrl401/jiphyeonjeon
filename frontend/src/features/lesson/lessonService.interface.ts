import type { UserRole } from '@/features/auth/types'
import type { CurriculumLiveSessionStatus, CurriculumReplayStatus, LessonStatus } from './types'

export interface LessonMaterialView {
  id: string
  name: string
  size: string
  status: string
  embeddingStatus?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  keyTermStatus?: 'NOT_REQUESTED' | 'PENDING' | 'PROCESSING' | 'READY' | 'EMPTY' | 'FAILED'
}

export interface LessonDetailView {
  lessonId: string
  title: string
  description: string
  status: LessonStatus
  deliveryType: 'LIVE' | 'RECORDED'
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
    lessons: Array<{
      lessonId: string
      title: string
      order: number
      deliveryType: 'LIVE' | 'RECORDED'
    }>
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
  /**
   * 자료 업로드 진행 보고. 레슨 저장 자체는 짧은 JSON 왕복이라 시간을 쓰는 건 자료 바이트뿐이다 —
   * 예전엔 버튼이 "저장 중…"으로 굳어 있어 몇 번째 파일에서 멈췄는지 알 수 없었다.
   */
  onMaterialProgress?: (progress: MaterialUploadProgress) => void
}

export interface MaterialUploadProgress {
  /** 지금 올리는 파일(1-based)과 전체 개수. */
  index: number
  count: number
  fileName: string
  /** 바이트 전송 비율(0~1). 전체 크기를 모르면 null. */
  ratio: number | null
}

export interface LessonStatusResult {
  lessonId: string
  status: LessonStatus
}

export interface LessonService {
  getLesson: (request: GetLessonRequest) => Promise<LessonDetailView>
  getCurriculumLessonNavigation: (curriculumId: string, role?: UserRole) => Promise<LessonNavigationView>
  saveLesson: (request: SaveLessonRequest) => Promise<{ lessonId: string; sectionId: string; title: string; description: string; status: LessonStatus }>
  deleteLessonMaterial: (lessonId: string, materialId: string) => Promise<void>
}
