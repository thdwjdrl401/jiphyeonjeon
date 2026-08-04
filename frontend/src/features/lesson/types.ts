export type LessonStatus = 'PUBLISHED'

export type LessonAccessDestination =
  | 'LESSON_DETAIL'
  | 'LIVE_SESSION'
  | 'LIVE_CLASSROOM'
  | 'VOD'
  | 'RECORDED_VOD'

export type LessonAccessReasonCode = 'ENROLLMENT_REQUIRED'

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
  status: LessonStatus
  deliveryType: 'LIVE' | 'RECORDED'
  scheduledAt: string | null
  durationMs: number | null
  liveSession: CurriculumLessonLiveSession | null
  replayStatus: CurriculumReplayStatus
  recordedPublicationStatus: 'DRAFT' | 'PUBLISHED' | null
  access: LessonAccess
  learning: LessonLearning | null
}
