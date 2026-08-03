import { beforeEach, describe, expect, it } from 'vitest'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { cancelEnrollment } from '@/features/enrollment/enrollmentService'
import { deleteLesson } from '@/features/curriculum/curriculumManagementService'
import {
  getNotificationSummary,
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  resolveNotificationTarget,
} from '@/features/notification/notificationService'
import { ApiError } from '@/shared/api/client'

async function loginAsStudent() {
  return mockAuthService.login({ email: 'student@example.com', password: 'password' })
}

async function loginAsInstructor() {
  return mockAuthService.login({ email: 'teacher@liveclass.ai', password: 'password' })
}

describe('알림 조회와 상태 처리', () => {
  beforeEach(() => {
    resetMockAuth()
  })

  it('로그인하지 않으면 알림을 조회할 수 없다', async () => {
    await expect(getNotifications()).rejects.toMatchObject({ status: 401 })
  })

  it('내 알림만 조회된다', async () => {
    const student = await loginAsStudent()
    const { items } = await getNotifications({ size: 50 })

    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.recipientId === student.userId)).toBe(true)
  })

  it('강사와 학생이 서로 다른 알림을 본다', async () => {
    await loginAsStudent()
    const studentTypes = new Set((await getNotifications({ size: 50 })).items.map((item) => item.type))

    await loginAsInstructor()
    const instructorItems = (await getNotifications({ size: 50 })).items

    // 수강 신청 접수는 강사만, 승인 결과는 학생만 본다.
    expect(instructorItems.some((item) => item.type === 'ENROLLMENT_REQUESTED')).toBe(true)
    expect(studentTypes.has('ENROLLMENT_REQUESTED')).toBe(false)
    expect(studentTypes.has('ENROLLMENT_APPROVED')).toBe(true)
  })

  it('목록은 최신순이고 페이지 단위로 끊어서 준다', async () => {
    await loginAsStudent()
    const first = await getNotifications({ page: 0, size: 3 })

    expect(first.items).toHaveLength(3)
    expect(first.hasNext).toBe(true)
    expect(first.totalElements).toBeGreaterThan(3)
    const createdAts = first.items.map((item) => item.createdAt)
    expect([...createdAts].sort().reverse()).toEqual(createdAts)

    const second = await getNotifications({ page: 1, size: 3 })
    const firstIds = new Set(first.items.map((item) => item.notificationId))
    expect(second.items.some((item) => firstIds.has(item.notificationId))).toBe(false)
  })

  it('읽음 축과 업무 처리 축이 각각 따로 동작한다', async () => {
    await loginAsInstructor()
    const unread = await getNotifications({ unreadOnly: true, size: 50 })
    const actionRequired = await getNotifications({ scope: 'ACTION_REQUIRED', size: 50 })

    expect(unread.items.length).toBeGreaterThan(0)
    expect(unread.items.every((item) => item.readStatus === 'UNREAD')).toBe(true)
    expect(actionRequired.items.length).toBeGreaterThan(0)
    expect(actionRequired.items.every((item) => item.actionStatus === 'ACTION_REQUIRED')).toBe(true)

    // 읽었지만 아직 처리하지 않은 알림이 있어야 두 축이 분리된 것이다.
    const readButPending = await getNotifications({ size: 50 })
    expect(
      readButPending.items.some(
        (item) => item.readStatus === 'READ' && item.actionStatus === 'COMPLETED',
      ),
    ).toBe(true)
  })

  it('두 축을 함께 주면 겹쳐서 걸러진다', async () => {
    await loginAsInstructor()
    /*
      하나의 enum으로 묶으면 물어볼 수 없는 질문이다 — "확인이 필요한 것 중 아직 안 읽은 것".
      seed에는 확인 필요이면서 읽은 알림이 없으므로, 하나를 읽어 두고 그 건이 빠지는지로 확인한다.
    */
    const before = await getNotifications({ scope: 'ACTION_REQUIRED', unreadOnly: true, size: 50 })
    expect(before.items.length).toBeGreaterThan(1)
    await markNotificationAsRead(before.items[0].notificationId)

    const after = await getNotifications({ scope: 'ACTION_REQUIRED', unreadOnly: true, size: 50 })
    expect(after.items).toHaveLength(before.items.length - 1)
    expect(after.items.every((item) => item.actionStatus === 'ACTION_REQUIRED')).toBe(true)
    expect(after.items.every((item) => item.readStatus === 'UNREAD')).toBe(true)

    // 읽음 필터만 끄면 방금 읽은 건이 다시 보인다 — 처리 축은 그대로다.
    const scopeOnly = await getNotifications({ scope: 'ACTION_REQUIRED', size: 50 })
    expect(scopeOnly.items).toHaveLength(before.items.length)
  })

  it('학생에게는 확인 필요 알림이 없다', async () => {
    // 화면에서 학생에게 '확인 필요' 탭을 내지 않는 근거다 — 항상 0건이다.
    await loginAsStudent()
    const actionRequired = await getNotifications({ scope: 'ACTION_REQUIRED', size: 50 })

    expect(actionRequired.items).toHaveLength(0)
    expect((await getNotificationSummary()).actionRequiredCount).toBe(0)
  })

  it('개수는 필터와 무관하게 전체 기준으로 내려온다', async () => {
    await loginAsInstructor()
    const summary = await getNotificationSummary()
    const filtered = await getNotifications({ scope: 'ACTION_REQUIRED', unreadOnly: true, size: 1 })

    expect(filtered.unreadCount).toBe(summary.unreadCount)
    expect(filtered.actionRequiredCount).toBe(summary.actionRequiredCount)
  })

  it('개별 읽음 처리는 멱등이고 처리 상태를 건드리지 않는다', async () => {
    await loginAsInstructor()
    const target = (await getNotifications({ scope: 'ACTION_REQUIRED', size: 50 })).items[0]

    const first = await markNotificationAsRead(target.notificationId)
    const second = await markNotificationAsRead(target.notificationId)

    expect(first.readStatus).toBe('READ')
    expect(second.readAt).toBe(first.readAt)
    expect(second.actionStatus).toBe('ACTION_REQUIRED')
  })

  it('모두 읽음은 읽지 않음만 0으로 만들고 처리 필요는 남긴다', async () => {
    await loginAsInstructor()
    const before = await getNotificationSummary()
    expect(before.unreadCount).toBeGreaterThan(0)

    const after = await markAllNotificationsAsRead()

    expect(after.unreadCount).toBe(0)
    expect(after.actionRequiredCount).toBe(before.actionRequiredCount)
  })

  it('남의 알림은 존재를 알리지 않는다', async () => {
    await loginAsInstructor()
    const instructorNotification = (await getNotifications({ size: 50 })).items[0]

    await loginAsStudent()
    await expect(markNotificationAsRead(instructorNotification.notificationId))
      .rejects.toMatchObject({ status: 404 })
  })

  it('대상이 살아 있으면 클릭 시점 상태를 함께 돌려준다', async () => {
    await loginAsStudent()
    const vod = (await getNotifications({ size: 50 })).items
      .find((item) => item.type === 'VOD_PUBLISHED')

    const resolution = await resolveNotificationTarget(vod!.notificationId)

    expect(resolution.status).toBe('AVAILABLE')
    if (resolution.status !== 'AVAILABLE') return
    expect(resolution.state.lessonId).toBe(vod!.targets.lessonId)
    expect(resolution.state.replayStatus).toBe('PUBLISHED')
  })

  it('대상이 삭제되면 접근 불가로 판정하고 처리 상태를 만료로 내린다', async () => {
    await loginAsStudent()
    const deletedTarget = (await getNotifications({ size: 50 })).items
      .find((item) => item.targets.lessonId === 'les-removed-demo')

    const resolution = await resolveNotificationTarget(deletedTarget!.notificationId)

    expect(resolution).toEqual({ status: 'GONE', reasonCode: 'TARGET_DELETED' })
    const after = (await getNotifications({ size: 50 })).items
      .find((item) => item.notificationId === deletedTarget!.notificationId)
    expect(after?.actionStatus).toBe('EXPIRED')
  })

  it('수강이 끊기면 이미 받은 강의 알림도 열 수 없다', async () => {
    await loginAsStudent()
    const lessonNotification = (await getNotifications({ size: 50 })).items
      .find((item) => item.type === 'LESSON_PUBLISHED' && item.targets.curriculumId === 'cur-spring-live')
    // 생성 당시에는 권한이 있었다.
    expect((await resolveNotificationTarget(lessonNotification!.notificationId)).status).toBe('AVAILABLE')

    await cancelEnrollment('cur-spring-live')

    expect(await resolveNotificationTarget(lessonNotification!.notificationId))
      .toEqual({ status: 'GONE', reasonCode: 'ACCESS_REVOKED' })
  })

  it('강의가 지워진 뒤 알림을 눌러도 오류가 아니라 안내로 끝난다', async () => {
    await loginAsInstructor()
    await deleteLesson('les-security')
    const liveNotification = (await getNotifications({ size: 50 })).items
      .find((item) => item.targets.lessonId === 'les-security')

    const resolution = await resolveNotificationTarget(liveNotification!.notificationId)

    expect(resolution.status).toBe('GONE')
    // 예외로 터지지 않는다 — 화면이 안내 문구를 고를 수 있어야 한다.
    expect(resolution).not.toBeInstanceOf(ApiError)
  })
})
