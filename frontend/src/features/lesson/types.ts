export type LessonStatus = 'DRAFT' | 'AI_NOT_READY' | 'READY' | 'PUBLISHED'

export type LessonAccessDestination = 'LESSON_DETAIL' | 'LIVE_SESSION' | 'LIVE_CLASSROOM' | 'VOD'

export type LessonAccessReasonCode =
  | 'ENROLLMENT_REQUIRED'
  | 'LESSON_NOT_PUBLISHED'
  | 'LIVE_NOT_STARTED'
  | 'REPLAY_NOT_PUBLISHED'

export type CurriculumLiveSessionStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'OPEN'
  | 'STARTING'
  | 'LIVE'
  | 'ENDING'
  | 'ENDED'
  | 'CANCELLED'
  | 'FAILED'

export type CurriculumReplayStatus =
  | 'NOT_READY'
  | 'DRAFT'
  | 'READY_FOR_REVIEW'
  | 'PUBLISHED'
  | 'WITHDRAWN'

export interface CurriculumLessonLiveSession {
  sessionId: string
  status: CurriculumLiveSessionStatus
  scheduledAt: string | null
}

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
  liveSession: CurriculumLessonLiveSession | null
  replayStatus: CurriculumReplayStatus
  access: LessonAccess
  learning: LessonLearning | null
}
