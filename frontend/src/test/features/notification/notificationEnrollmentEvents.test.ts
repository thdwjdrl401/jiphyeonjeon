import { beforeEach, describe, expect, it } from 'vitest'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import {
  cancelEnrollment,
  enrollInCurriculum,
  transitionEnrollment,
} from '@/features/enrollment/enrollmentService'
import {
  getNotifications,
  markNotificationAsRead,
} from '@/features/notification/notificationService'
import type { NotificationItem, NotificationType } from '@/features/notification/types'

/**
 * 수강 신청 알림의 생성·수신자·상태 전이.
 *
 * <p>서비스 facade만 호출한다 — 알림 저장소를 직접 들여다보면 "도메인 행동이 알림을 만든다"는
 * 성질이 아니라 저장소 함수를 검증하게 된다.
 */
const OWNED_CURRICULUM = 'cur-spring-live'
const OWNED_ENROLLMENT = 'enr-spring-active'
/** 다른 강사(usr-instructor-09)의 승인제 커리큘럼. 데모 강사에게 알림이 새지 않는지 확인한다. */
const OTHER_INSTRUCTOR_CURRICULUM = 'cur-ux-research'

async function loginAsStudent() {
  return mockAuthService.login({ email: 'student@example.com', password: 'password' })
}

async function loginAsInstructor() {
  return mockAuthService.login({ email: 'teacher@liveclass.ai', password: 'password' })
}

async function listNotifications() {
  const { items } = await getNotifications({ size: 50 })
  return items
}

function find(items: NotificationItem[], type: NotificationType, enrollmentId: string) {
  return items.find((item) => item.type === type && item.targets.enrollmentId === enrollmentId) ?? null
}

/**
 * 데모 학생은 이미 이 커리큘럼을 수강 중이라(ACTIVE) 그대로 신청하면 409다. 취소 후 다시 신청해
 * "새 신청" 상태를 만든다 — 실제 사용자가 취소하고 다시 신청하는 경로와 같다.
 */
async function reapplyToOwnedCurriculum() {
  await cancelEnrollment(OWNED_CURRICULUM)
  return enrollInCurriculum(OWNED_CURRICULUM)
}

describe('수강 신청 알림', () => {
  beforeEach(() => {
    resetMockAuth()
  })

  it('학생이 신청하면 담당 강사에게 확인이 필요한 알림이 생긴다', async () => {
    await loginAsStudent()
    await reapplyToOwnedCurriculum()

    await loginAsInstructor()
    const requested = find(await listNotifications(), 'ENROLLMENT_REQUESTED', OWNED_ENROLLMENT)

    expect(requested).not.toBeNull()
    expect(requested?.readStatus).toBe('UNREAD')
    expect(requested?.actionStatus).toBe('ACTION_REQUIRED')
    expect(requested?.message).toContain('김학생')
    expect(requested?.targets.curriculumId).toBe(OWNED_CURRICULUM)
    // 목록에서 신청자를 찾아 강조할 수 있어야 한다.
    expect(requested?.targets.studentId).toBe('usr-student-01')
  })

  it('담당이 아닌 강사에게는 알림이 생기지 않는다', async () => {
    await loginAsStudent()
    const applied = await enrollInCurriculum(OTHER_INSTRUCTOR_CURRICULUM)
    expect(applied.status).toBe('PENDING')

    await loginAsInstructor()
    const items = await listNotifications()

    expect(find(items, 'ENROLLMENT_REQUESTED', applied.enrollmentId)).toBeNull()
    expect(items.every((item) => item.targets.curriculumId !== OTHER_INSTRUCTOR_CURRICULUM)).toBe(true)
  })

  it('같은 신청으로 알림이 두 번 생기지 않는다', async () => {
    await loginAsStudent()
    await reapplyToOwnedCurriculum()
    // 같은 상태에서 다시 신청하면 서버는 409로 막는다 — 그 재시도가 알림을 늘리지 않아야 한다.
    await expect(enrollInCurriculum(OWNED_CURRICULUM)).rejects.toThrow()

    await loginAsInstructor()
    const requested = (await listNotifications()).filter(
      (item) => item.type === 'ENROLLMENT_REQUESTED' && item.targets.enrollmentId === OWNED_ENROLLMENT,
    )

    expect(requested).toHaveLength(1)
  })

  it('읽음 처리만으로는 처리 완료가 되지 않는다', async () => {
    await loginAsStudent()
    await reapplyToOwnedCurriculum()

    await loginAsInstructor()
    const requested = find(await listNotifications(), 'ENROLLMENT_REQUESTED', OWNED_ENROLLMENT)
    await markNotificationAsRead(requested!.notificationId)

    const afterRead = find(await listNotifications(), 'ENROLLMENT_REQUESTED', OWNED_ENROLLMENT)
    expect(afterRead?.readStatus).toBe('READ')
    // 승인·거절을 하지 않았으므로 할 일은 그대로 남는다.
    expect(afterRead?.actionStatus).toBe('ACTION_REQUIRED')
    expect(afterRead?.completedAt).toBeNull()
  })

  it('승인하면 학생에게 승인 알림이 생기고 강사 알림은 처리 완료가 된다', async () => {
    await loginAsStudent()
    await reapplyToOwnedCurriculum()

    await loginAsInstructor()
    await transitionEnrollment(OWNED_CURRICULUM, OWNED_ENROLLMENT, 'approve')
    const instructorNotification = find(
      await listNotifications(),
      'ENROLLMENT_REQUESTED',
      OWNED_ENROLLMENT,
    )
    expect(instructorNotification?.actionStatus).toBe('COMPLETED')
    expect(instructorNotification?.completedAt).not.toBeNull()

    await loginAsStudent()
    const approved = find(await listNotifications(), 'ENROLLMENT_APPROVED', OWNED_ENROLLMENT)
    expect(approved?.readStatus).toBe('UNREAD')
    // 학생이 할 일은 없다 — 안내성 알림이다.
    expect(approved?.actionStatus).toBe('INFO')
    expect(approved?.title).toBe('수강 신청이 승인되었습니다.')
  })

  it('거절하면 학생에게 거절 알림이 생기고 강사 알림은 처리 완료가 된다', async () => {
    await loginAsStudent()
    await reapplyToOwnedCurriculum()

    await loginAsInstructor()
    await transitionEnrollment(OWNED_CURRICULUM, OWNED_ENROLLMENT, 'reject')
    expect(find(await listNotifications(), 'ENROLLMENT_REQUESTED', OWNED_ENROLLMENT)?.actionStatus)
      .toBe('COMPLETED')

    await loginAsStudent()
    const rejected = find(await listNotifications(), 'ENROLLMENT_REJECTED', OWNED_ENROLLMENT)
    expect(rejected).not.toBeNull()
    expect(rejected?.title).toBe('수강 신청이 승인되지 않았습니다.')
  })

  it('학생이 신청을 취소하면 강사의 확인 필요 알림이 만료된다', async () => {
    await loginAsStudent()
    await reapplyToOwnedCurriculum()
    await cancelEnrollment(OWNED_CURRICULUM)

    await loginAsInstructor()
    const requested = find(await listNotifications(), 'ENROLLMENT_REQUESTED', OWNED_ENROLLMENT)

    // 처리할 수 없게 된 일은 "확인 필요"에서 빠져야 한다.
    expect(requested?.actionStatus).toBe('EXPIRED')
  })
})
