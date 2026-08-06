import { peekMockUser } from '@/features/auth/mockAuthService'
import { findMockLesson, getMockCurriculum } from '@/features/demo/mockDatabase'
import { getMockEnrollment } from '@/features/enrollment/mockEnrollmentStore'
import { ApiError } from '@/shared/api/client'
import type { NotificationService } from './notificationService.interface'
import {
  getMockNotificationPreference,
  saveMockNotificationPreference,
} from './mockNotificationPreferenceStore'
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
  NotificationSignal,
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

/**
 * 입장을 안내하던 알림. **이것들만** 라이브 취소를 만료로 본다 — 데려갈 입장 화면이 사라졌기 때문이다.
 * `LIVE_CANCELED`는 여기 없다: 취소를 알리는 알림이 취소를 이유로 닫히면 그 알림만 열리지 않는다.
 */
const entryTypes: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'LIVE_SCHEDULED',
  'LIVE_STARTING_SOON',
  'LIVE_SCHEDULE_CHANGED',
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

  // 취소를 만료로 보는 것은 입장을 안내하던 알림뿐이다 — 취소 통보 자신과 자료·다시보기는 그대로 열린다.
  const liveSession = found?.lesson.liveSession ?? null
  if (liveSession?.status === 'CANCELLED' && entryTypes.has(record.type)) {
    return gone(record, 'TARGET_EXPIRED')
  }

  /*
    공개했다가 내린 다시보기. 학생을 보내면 재생이 404를 내고 서버 장애와 같은 문구가 뜬다.
    강사는 막지 않는다 — 다시 게시하는 자리가 그 화면이다.
  */
  const replayStatus = found?.lesson.replayStatus ?? null
  const isOwner = curriculum?.instructor.instructorId === user.userId
  if (record.type === 'VOD_PUBLISHED' && !isOwner && replayStatus !== 'PUBLISHED') {
    return gone(record, 'TARGET_DELETED')
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
      replayStatus,
      deliveryType: found?.lesson.deliveryType ?? null,
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
   * 목에는 브로커가 없다. 붙을 곳이 없으므로 신호는 영영 오지 않는다.
   *
   * <p><b>연결됐다는 사실만 한 번 알린다.</b> 실서비스에서 이 콜백이 재연결 공백을 메우는데,
   * 목이 그것을 아예 부르지 않으면 화면의 "붙으면 맞춘다" 경로가 목 모드에서 죽은 코드가 된다 —
   * 목으로 개발하는 동안 그 경로가 깨져도 모른다.
   *
   * <p>목 모드에서 알림이 갱신되는 시점은 이제 <b>마운트·창 복귀·직접 무효화</b>다. 폴링이
   * 있을 때보다 늦게 뜨지만 깨지지는 않는다(목의 알림은 같은 탭의 내 행동으로만 생긴다).
   */
  subscribeNotifications(_onSignal: (signal: NotificationSignal) => void, onConnected?: () => void) {
    onConnected?.()
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
  async getNotificationPreference(curriculumId, lessonId) {
    const user = requireUser()
    return getMockNotificationPreference(user.userId, curriculumId, lessonId)
  },
  async saveNotificationPreference(input) {
    const user = requireUser()
    saveMockNotificationPreference(user.userId, input)
  },
  async registerPushSubscription() {},
  async unregisterPushSubscription() {},
  /*
   * 목에는 VAPID 공개키가 없어(getPushPublicKey → null) 화면이 푸시 UI를 켜지 않으므로 여기까지
   * 오지 않는다. 그래도 false를 준다 — 혹시 불렸을 때 "켜짐"으로 보이는 쪽이 더 나쁘다.
   */
  async isPushSubscriptionRegistered() {
    return false
  },
} satisfies NotificationService
