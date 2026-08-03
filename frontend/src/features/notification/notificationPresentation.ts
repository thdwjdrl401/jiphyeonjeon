import type { NotificationActionStatus, NotificationSeverity, NotificationType } from './types'

/**
 * 알림 종류를 사람이 훑을 수 있는 분류로 접는다. 종류는 12개지만 목록에서 구별해야 하는 축은
 * 그보다 적다 — 배지에 `ENROLLMENT_REQUESTED` 같은 코드를 그대로 보여 주지 않는다.
 */
export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationType, string> = {
  ENROLLMENT_REQUESTED: '수강 신청',
  ENROLLMENT_APPROVED: '수강 승인',
  ENROLLMENT_REJECTED: '수강 신청',
  LIVE_SCHEDULED: '라이브 일정',
  LIVE_STARTING_SOON: '라이브 임박',
  LIVE_SCHEDULE_CHANGED: '일정 변경',
  LIVE_CANCELED: '일정 취소',
  LESSON_PUBLISHED: '새 강의',
  MATERIAL_PUBLISHED: '학습 자료',
  RECORDING_READY: '녹화',
  RECORDING_FAILED: '녹화 오류',
  VOD_PUBLISHED: '다시보기',
}

export type NotificationBadgeTone = 'neutral' | 'success' | 'warning' | 'danger'

/**
 * 처리 축의 표시. `INFO`는 배지를 내지 않는다 — 안내성 알림이 대부분이라 전부에 배지를 붙이면
 * 정작 확인이 필요한 줄이 묻힌다.
 */
export const ACTION_STATUS_BADGE: Record<
  NotificationActionStatus,
  { label: string; tone: NotificationBadgeTone } | null
> = {
  INFO: null,
  ACTION_REQUIRED: { label: '확인 필요', tone: 'warning' },
  COMPLETED: { label: '처리 완료', tone: 'success' },
  EXPIRED: { label: '만료됨', tone: 'neutral' },
}

export function severityBadgeTone(severity: NotificationSeverity): NotificationBadgeTone | null {
  if (severity === 'ERROR') return 'danger'
  if (severity === 'HIGH') return 'warning'
  return null
}

const dayFormatter = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 발생 시각 표기. 최근 것은 상대 시간("12분 전")이 알림 목록에서 훑기 쉽고, 오래된 것은
 * "9일 전"보다 날짜가 낫다. 7일을 경계로 바꾼다.
 */
export function formatNotificationTime(createdAt: string, now = Date.now()) {
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return ''

  const elapsed = now - created
  // 시계 차이로 미래가 되는 경우(서버·클라 시각 어긋남)를 "방금"으로 흡수한다.
  if (elapsed < MINUTE) return '방금 전'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}분 전`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}시간 전`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}일 전`
  return dayFormatter.format(created)
}

/** 대상이 사라진 알림을 눌렀을 때의 안내. 기술적인 이유가 아니라 사용자가 할 수 있는 판단을 적는다. */
export const GONE_REASON_MESSAGE = {
  TARGET_DELETED: '삭제되었거나 더 이상 접근할 수 없는 알림입니다.',
  ACCESS_REVOKED: '더 이상 접근할 수 없는 알림입니다. 수강 상태가 변경되었을 수 있습니다.',
  TARGET_EXPIRED: '처리 가능 기간이 지난 알림입니다.',
} as const
