export type LessonStatus = 'DRAFT' | 'AI_NOT_READY' | 'READY' | 'PUBLISHED'

export type LessonAccessDestination = 'LESSON_DETAIL' | 'LIVE_SESSION' | 'LIVE_CLASSROOM' | 'VOD'

export type LessonAccessReasonCode =
  | 'ENROLLMENT_REQUIRED'
  | 'LESSON_NOT_PUBLISHED'
  | 'LIVE_NOT_STARTED'
  | 'REPLAY_NOT_PUBLISHED'

export interface LessonAccess {
  allowed: boolean
  destination: LessonAccessDestination | null
  reasonCode: LessonAccessReasonCode | null
}

export interface LessonLearning {
  completed: boolean
  progressPercent: number
}

export interface CurriculumOutlineLesson {
  lessonId: string
  title: string
  order: number
  lessonStatus: LessonStatus
  scheduledAt: string | null
  durationMs: number | null
  access: LessonAccess
  learning: LessonLearning | null
}
