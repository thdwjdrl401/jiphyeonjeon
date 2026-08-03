import { peekMockUser } from '@/features/auth/mockAuthService'
import { findMockLesson, getMockCurriculum } from '@/features/demo/mockDatabase'
import { getMockEnrollment } from '@/features/enrollment/mockEnrollmentStore'
import { ApiError } from '@/shared/api/client'
import type { NotificationService } from './notificationService.interface'
import {
  findMockNotification,
  listMockNotifications,
  markAllMockNotificationsRead,
  markMockNotificationRead,
  setMockNotificationActionStatus,
  type MockNotificationRecord,
} from './mockNotificationStore'
import type {
  NotificationGoneReason,
  NotificationItem,
  NotificationListResponse,
  NotificationTargetResolution,
  NotificationType,
} from './types'

/** 드롭다운·페이지가 각자 크기를 넘기지만, 서버가 상한을 둔다(무제한 조회 금지). */
const MAX_PAGE_SIZE = 50

async function wait() {
  if (import.meta.env.MODE === 'test') return
  await new Promise((resolve) => window.setTimeout(resolve, 240))
}

function requireUser() {
  const user = peekMockUser()
  if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
  return user
}

/** 남의 알림은 존재 자체를 알리지 않는다 — 403은 "그 알림이 있다"는 정보를 준다. */
function requireOwnNotification(notificationId: string, recipientId: string) {
  const record = findMockNotification(notificationId)
  if (!record || record.recipientId !== recipientId) {
    throw new ApiError('알림을 찾을 수 없어요.', 404, 'NOTIFICATION_NOT_FOUND')
  }
  return record
}

/**
 * 저장 레코드 → 화면 모델.
 *
 * <p>필드를 하나씩 옮긴다(스프레드 후 `dedupeKey` 삭제가 아니라) — 저장 레코드에 내부 필드를
 * 더할 때 그것이 응답으로 새어 나가지 않게 하려면 <b>내보낼 것만</b> 적는 편이 안전하다.
 */
function toItem(record: MockNotificationRecord): NotificationItem {
  return {
    notificationId: record.notificationId,
    recipientId: record.recipientId,
    type: record.type,
    readStatus: record.readStatus,
    actionStatus: record.actionStatus,
    severity: record.severity,
    title: record.title,
    message: record.message,
    targets: { ...record.targets },
    groupKey: record.groupKey,
    createdAt: record.createdAt,
    readAt: record.readAt,
    completedAt: record.completedAt,
    scheduleChange: record.scheduleChange,
  }
}

function summarize(records: MockNotificationRecord[]) {
  return {
    unreadCount: records.filter((record) => record.readStatus === 'UNREAD').length,
    actionRequiredCount: records.filter((record) => record.actionStatus === 'ACTION_REQUIRED').length,
  }
}

/** 수강 관계를 근거로 열람 여부를 판정하는 알림 종류. 수강이 끊기면 더 이상 열 수 없다. */
const requiresActiveEnrollment: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'LIVE_SCHEDULED',
  'LIVE_STARTING_SOON',
  'LIVE_SCHEDULE_CHANGED',
  'LIVE_CANCELED',
  'LESSON_PUBLISHED',
  'MATERIAL_PUBLISHED',
  'VOD_PUBLISHED',
])

function gone(record: MockNotificationRecord, reasonCode: NotificationGoneReason): NotificationTargetResolution {
  // 다시 열릴 수 없는 알림이므로 처리 축을 EXPIRED로 내린다 — 목록에서 "처리 대기"로 계속 남지 않게.
  setMockNotificationActionStatus(record.notificationId, 'EXPIRED', new Date().toISOString())
  return { status: 'GONE', reasonCode }
}

/**
 * 클릭 시점의 대상 상태 재판정.
 *
 * <p>생성 당시의 권한을 믿지 않는다. 알림이 남아 있는 동안 수강이 취소되고, 커리큘럼이 삭제되고,
 * 강의가 지워질 수 있다 — 그 상태로 이동시키면 빈 화면이나 403이 나온다.
 */
function resolveMockTarget(record: MockNotificationRecord): NotificationTargetResolution {
  const user = requireUser()
  const { curriculumId, lessonId, enrollmentId, studentId, liveSessionId } = record.targets

  const curriculum = curriculumId ? getMockCurriculum(curriculumId) : null
  if (curriculumId && !curriculum) return gone(record, 'TARGET_DELETED')

  const found = lessonId ? findMockLesson(lessonId) : null
  if (lessonId && !found) return gone(record, 'TARGET_DELETED')

  if (user.role === 'INSTRUCTOR') {
    // 강사 계정이라는 이유만으로는 열 수 없다. 지금도 담당 강사여야 한다(강사 변경 대응).
    if (curriculum && curriculum.instructor.instructorId !== user.userId) {
      return gone(record, 'ACCESS_REVOKED')
    }
  } else if (requiresActiveEnrollment.has(record.type) && curriculumId) {
    const enrollment = getMockEnrollment(user.userId, curriculumId)
    if (enrollment?.status !== 'ACTIVE') return gone(record, 'ACCESS_REVOKED')
  }

  const liveSession = found?.lesson.liveSession ?? null
  if (liveSession?.status === 'CANCELLED' && record.type !== 'LIVE_CANCELED') {
    return gone(record, 'TARGET_EXPIRED')
  }

  return {
    status: 'AVAILABLE',
    state: {
      curriculumId: curriculumId ?? null,
      sectionId: found?.section.sectionId ?? record.targets.sectionId ?? null,
      lessonId: lessonId ?? null,
      liveSessionId: liveSession?.sessionId ?? liveSessionId ?? null,
      enrollmentId: enrollmentId ?? null,
      studentId: studentId ?? null,
      liveSessionStatus: liveSession?.status ?? null,
      scheduledAt: liveSession?.scheduledAt ?? found?.lesson.scheduledAt ?? null,
      replayStatus: found?.lesson.replayStatus ?? null,
    },
  }
}

export const mockNotificationService = {
  async getSummary() {
    await wait()
    const user = requireUser()
    return summarize(listMockNotifications(user.userId))
  },

  async getNotifications(query = {}) {
    await wait()
    const user = requireUser()
    const all = listMockNotifications(user.userId)
    // 두 축을 AND로 겹친다 — "처리 대기 중 아직 안 읽은 것"이 표현돼야 한다.
    const filtered = all.filter((record) => {
      if (query.scope === 'ACTION_REQUIRED' && record.actionStatus !== 'ACTION_REQUIRED') return false
      if (query.readState && record.readStatus !== query.readState) return false
      return true
    })

    const page = Math.max(0, query.page ?? 0)
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? 10))
    const start = page * size

    return {
      items: filtered.slice(start, start + size).map(toItem),
      page,
      size,
      totalElements: filtered.length,
      totalPages: Math.ceil(filtered.length / size),
      hasNext: start + size < filtered.length,
      // 개수는 필터와 무관한 전체 기준이다 — 배지가 필터에 따라 흔들리면 안 된다.
      ...summarize(all),
    } satisfies NotificationListResponse
  },

  async markAsRead(notificationId) {
    await wait()
    const user = requireUser()
    const record = requireOwnNotification(notificationId, user.userId)
    markMockNotificationRead(record.notificationId, new Date().toISOString())
    return toItem(record)
  },

  async markAllAsRead() {
    await wait()
    const user = requireUser()
    markAllMockNotificationsRead(user.userId, new Date().toISOString())
    return summarize(listMockNotifications(user.userId))
  },

  async resolveTarget(notificationId) {
    await wait()
    const user = requireUser()
    const record = requireOwnNotification(notificationId, user.userId)
    return resolveMockTarget(record)
  },
  /**
   * 목에는 실시간 채널이 없다. 브로커에 붙지 않고 <b>아무것도 하지 않는 해제 함수</b>를 준다 —
   * 화면은 폴링으로도 동작하므로 목 모드에서 알림이 늦게 뜰 뿐 깨지지 않는다.
   */
  subscribeNotifications() {
    return () => {}
  },
  /** 목에는 푸시가 없다. 공개키를 null로 주면 화면이 알아서 푸시 UI를 숨긴다. */
  async getPushPublicKey() {
    return null
  },
  /** 목은 서버 기본값과 같은 선택지를 그대로 흉내 낸다 — 화면이 목에서도 진짜처럼 동작해야 한다. */
  async getNotificationLeadTimes() {
    return { choices: [5, 10, 30, 60, 180, 1440], defaultMinutes: 10 }
  },
  async getNotificationPreference() {
    return { enabled: true, leadMinutes: 10, source: 'DEFAULT' as const }
  },
  async saveNotificationPreference() {},
  async registerPushSubscription() {},
  async unregisterPushSubscription() {},
} satisfies NotificationService
