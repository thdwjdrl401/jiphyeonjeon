import type {
  NotificationActionStatus,
  NotificationItem,
  NotificationScheduleChange,
  NotificationSeverity,
  NotificationTargets,
  NotificationType,
} from './types'

/**
 * 저장된 알림 한 건. `dedupeKey`는 화면 모델에 없다 — 중복 방지는 서버(여기서는 mock 저장소)의
 * 책임이고, 화면이 그 값을 보고 분기하면 방지 규칙이 두 곳으로 흩어진다.
 */
export interface MockNotificationRecord extends NotificationItem {
  /**
   * 멱등 키. `이벤트 유형 : 수신자 : 관련 리소스`로 만든다. 같은 이벤트가 재시도돼도
   * (Egress webhook 재전송, 승인 버튼 두 번 누르기) 같은 키가 나오므로 한 건만 남는다.
   */
  dedupeKey: string
}

/**
 * 처리 축의 기본값. "읽으면 끝"이 아닌 알림만 ACTION_REQUIRED로 시작한다.
 *
 * <p>RECORDING_READY가 ACTION_REQUIRED인 이유: 현재 서버는 녹화가 READY가 되면 다시보기를
 * 자동 게시하지만(`RecordingService.markReady`), 강사가 녹화본을 <b>확인</b>했는지는 별개다.
 * 그 확인이 남은 일이므로 강사가 검수 화면을 열 때 COMPLETED가 된다.
 */
const defaultActionStatus: Record<NotificationType, NotificationActionStatus> = {
  ENROLLMENT_REQUESTED: 'ACTION_REQUIRED',
  ENROLLMENT_APPROVED: 'INFO',
  ENROLLMENT_REJECTED: 'INFO',
  LIVE_SCHEDULED: 'INFO',
  LIVE_STARTING_SOON: 'INFO',
  LIVE_SCHEDULE_CHANGED: 'INFO',
  LIVE_CANCELED: 'INFO',
  LESSON_PUBLISHED: 'INFO',
  MATERIAL_PUBLISHED: 'INFO',
  RECORDING_READY: 'ACTION_REQUIRED',
  RECORDING_FAILED: 'ACTION_REQUIRED',
  VOD_PUBLISHED: 'INFO',
}

const defaultSeverity: Record<NotificationType, NotificationSeverity> = {
  ENROLLMENT_REQUESTED: 'NORMAL',
  ENROLLMENT_APPROVED: 'NORMAL',
  ENROLLMENT_REJECTED: 'NORMAL',
  LIVE_SCHEDULED: 'NORMAL',
  LIVE_STARTING_SOON: 'HIGH',
  LIVE_SCHEDULE_CHANGED: 'HIGH',
  LIVE_CANCELED: 'HIGH',
  LESSON_PUBLISHED: 'NORMAL',
  MATERIAL_PUBLISHED: 'NORMAL',
  RECORDING_READY: 'NORMAL',
  RECORDING_FAILED: 'ERROR',
  VOD_PUBLISHED: 'NORMAL',
}

export interface AppendNotificationInput {
  recipientId: string
  type: NotificationType
  title: string
  message: string
  targets: NotificationTargets
  /**
   * 중복 방지 키의 <b>리소스 부분</b>. 이벤트가 가리키는 대상을 유일하게 정하는 값을 넘긴다
   * (수강 신청이면 enrollmentId, 일정 변경이면 `sessionId:새 시각`).
   */
  dedupeResource: string
  createdAt: string
  actionStatus?: NotificationActionStatus
  severity?: NotificationSeverity
  scheduleChange?: NotificationScheduleChange | null
  /** 이미 읽은 상태로 심는 seed용. 실제 이벤트는 항상 UNREAD로 만든다. */
  readAt?: string | null
}

let records: MockNotificationRecord[] = []
let sequence = 0

/**
 * 알림을 쌓는다. 같은 `dedupeKey`가 이미 있으면 <b>아무 것도 하지 않고</b> 기존 건을 돌려준다 —
 * 같은 수강 신청으로 강사에게 두 번, 같은 녹화 완료 webhook 재시도로 또 한 번 쌓이지 않게.
 */
export function appendMockNotification(input: AppendNotificationInput): MockNotificationRecord {
  const dedupeKey = `${input.type}:${input.recipientId}:${input.dedupeResource}`
  const existing = records.find((record) => record.dedupeKey === dedupeKey)
  if (existing) return existing

  sequence += 1
  const record: MockNotificationRecord = {
    notificationId: `ntf-mock-${sequence}`,
    recipientId: input.recipientId,
    type: input.type,
    readStatus: input.readAt ? 'READ' : 'UNREAD',
    actionStatus: input.actionStatus ?? defaultActionStatus[input.type],
    severity: input.severity ?? defaultSeverity[input.type],
    title: input.title,
    message: input.message,
    targets: { ...input.targets },
    // 묶음 키는 "같은 커리큘럼의 같은 종류"까지만 좁힌다. 개별 리소스까지 넣으면 묶을 것이 없다.
    groupKey: `${input.type}:${input.targets.curriculumId ?? 'none'}`,
    createdAt: input.createdAt,
    readAt: input.readAt ?? null,
    completedAt: null,
    scheduleChange: input.scheduleChange ?? null,
    dedupeKey,
  }
  records.push(record)
  return record
}

/** 최신순 목록. 같은 시각이면 나중에 쌓인 것을 위로 둔다(seed끼리 시각이 겹칠 수 있다). */
export function listMockNotifications(recipientId: string): MockNotificationRecord[] {
  return records
    .filter((record) => record.recipientId === recipientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.notificationId.localeCompare(a.notificationId))
}

export function findMockNotification(notificationId: string): MockNotificationRecord | null {
  return records.find((record) => record.notificationId === notificationId) ?? null
}

export function markMockNotificationRead(notificationId: string, readAt: string) {
  const record = findMockNotification(notificationId)
  if (!record) return null
  // 이미 읽은 알림의 readAt은 덮어쓰지 않는다 — 처음 읽은 시각이 이력이다.
  if (record.readStatus === 'UNREAD') {
    record.readStatus = 'READ'
    record.readAt = readAt
  }
  return record
}

export function markAllMockNotificationsRead(recipientId: string, readAt: string) {
  for (const record of records) {
    if (record.recipientId !== recipientId) continue
    if (record.readStatus === 'READ') continue
    record.readStatus = 'READ'
    record.readAt = readAt
  }
}

/**
 * 처리 축만 바꾼다. 읽음 축은 건드리지 않는다 — 두 축이 서로를 따라 움직이면 분리한 의미가 없다.
 * 이미 같은 상태면 `completedAt`을 다시 찍지 않는다(승인 버튼 재클릭 멱등).
 */
export function setMockNotificationActionStatus(
  notificationId: string,
  actionStatus: NotificationActionStatus,
  at: string,
) {
  const record = findMockNotification(notificationId)
  if (!record) return null
  if (record.actionStatus === actionStatus) return record
  record.actionStatus = actionStatus
  record.completedAt = actionStatus === 'COMPLETED' ? at : null
  return record
}

/**
 * 조건에 맞는 알림의 처리 축을 한꺼번에 바꾼다. 강사가 수강 신청을 승인하면 그 신청으로 만들어진
 * ACTION_REQUIRED 알림을 찾아 COMPLETED로 내려야 하는데, 화면은 그 알림의 id를 모른다.
 */
export function completeMockNotificationsFor(
  match: { recipientId?: string; type: NotificationType; targets: Partial<NotificationTargets> },
  actionStatus: NotificationActionStatus,
  at: string,
) {
  const targetEntries = Object.entries(match.targets) as Array<[keyof NotificationTargets, string]>
  const matched = records.filter((record) => {
    if (record.type !== match.type) return false
    if (match.recipientId && record.recipientId !== match.recipientId) return false
    return targetEntries.every(([key, value]) => record.targets[key] === value)
  })
  for (const record of matched) {
    setMockNotificationActionStatus(record.notificationId, actionStatus, at)
  }
  return matched
}

export function clearMockNotifications() {
  records = []
  sequence = 0
}
