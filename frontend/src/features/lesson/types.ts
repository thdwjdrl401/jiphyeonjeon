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

/**
 * 다시보기 공개 상태. `NOT_READY`는 녹화 자산 자체가 없다는 카탈로그 표현이고, 나머지 셋이 서버의
 * `ReplayStatus`다.
 *
 * <p><b>검수 단계가 없다.</b> 정상 녹화는 완료와 함께 자동으로 `PUBLISHED`가 된다(ADR-0090).
 * `DRAFT`에 남아 있으면 대개 녹화가 실패한 자산이다.
 */
export type CurriculumReplayStatus =
  | 'NOT_READY'
  | 'DRAFT'
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
