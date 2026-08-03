import { beforeEach, describe, expect, it } from 'vitest'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { getMockCurriculum } from '@/features/demo/mockDatabase'
import { deleteLesson } from '@/features/curriculum/curriculumManagementService'
import { saveLesson } from '@/features/lesson/lessonService'
import {
  publishLessonCreated,
  publishMaterialPublished,
} from '@/features/notification/mockNotificationEvents'
import { getNotifications } from '@/features/notification/notificationService'
import type { NotificationItem, NotificationType } from '@/features/notification/types'

/**
 * 강의·자료·라이브 일정 알림.
 *
 * <p>학생 알림이 "실제로 공개된 시점에만" 생기는지, 그리고 수강 승인 학생에게만 가는지를 본다.
 */
const PUBLISHED_CURRICULUM = 'cur-spring-live'
const PUBLISHED_SECTION = 'sec-foundation'
/** 게시 전(DRAFT) 커리큘럼. 이 안의 강의는 학생에게 보이지 않는다. */
const DRAFT_CURRICULUM = 'cur-architecture'
const DRAFT_SECTION = 'cur-architecture-section-1'
const SCHEDULED_LESSON = 'les-security'

async function loginAsStudent() {
  return mockAuthService.login({ email: 'student@example.com', password: 'password' })
}

async function loginAsInstructor() {
  return mockAuthService.login({ email: 'teacher@liveclass.ai', password: 'password' })
}

async function studentNotifications(type: NotificationType): Promise<NotificationItem[]> {
  const { items } = await getNotifications({ size: 50 })
  return items.filter((item) => item.type === type)
}

describe('강의·자료·라이브 일정 알림', () => {
  beforeEach(() => {
    resetMockAuth()
  })

  it('새 강의를 만들면 수강 승인 학생에게 공개 알림이 생긴다', async () => {
    await loginAsInstructor()
    const created = await saveLesson({
      sectionId: PUBLISHED_SECTION,
      title: 'React Query 기초',
      description: '캐싱 전략을 다룹니다.',
      scheduledAt: '2026-08-12T19:00:00+09:00',
      materials: [],
    })

    await loginAsStudent()
    const published = (await studentNotifications('LESSON_PUBLISHED'))
      .find((item) => item.targets.lessonId === created.lessonId)

    expect(published).toBeDefined()
    expect(published?.title).toBe('새로운 강의가 공개되었습니다.')
    expect(published?.message).toContain('React Query 기초')
    expect(published?.actionStatus).toBe('INFO')
    // 목적지 계산에 필요한 리소스 id가 저장돼야 한다(경로 문자열이 아니라).
    expect(published?.targets.curriculumId).toBe(PUBLISHED_CURRICULUM)
    expect(published?.targets.sectionId).toBe(PUBLISHED_SECTION)
  })

  it('게시되지 않은 커리큘럼의 강의는 학생 알림을 만들지 않는다', async () => {
    expect(getMockCurriculum(DRAFT_CURRICULUM)?.lifecycleStatus).toBe('DRAFT')

    const draftFanout = publishLessonCreated({
      sectionId: DRAFT_SECTION,
      lessonId: 'les-draft-only',
      lessonTitle: '초안 강의',
      scheduledAt: '2026-09-01T19:00:00+09:00',
    })
    const publishedFanout = publishLessonCreated({
      sectionId: PUBLISHED_SECTION,
      lessonId: 'les-published-check',
      lessonTitle: '공개 강의',
      scheduledAt: '2026-09-01T19:00:00+09:00',
    })

    expect(draftFanout).toHaveLength(0)
    // 같은 함수가 공개된 커리큘럼에서는 알림을 만든다 — 위 결과가 "아무 것도 안 하는 함수"라서
    // 비어 있는 것이 아니라 게시 여부로 갈린 것임을 같은 테스트에서 확인한다.
    expect(publishedFanout.length).toBeGreaterThan(0)
    expect(publishedFanout.every((item) => item.recipientId === 'usr-student-01')).toBe(true)
  })

  it('라이브 시작 시각을 바꾸면 변경 전·후가 담긴 알림이 생긴다', async () => {
    await loginAsInstructor()
    await saveLesson({
      sectionId: 'sec-security',
      lessonId: SCHEDULED_LESSON,
      title: 'Spring Security 시작하기',
      description: '',
      scheduledAt: '2026-08-20T21:00:00+09:00',
      materials: [],
    })

    await loginAsStudent()
    const changed = (await studentNotifications('LIVE_SCHEDULE_CHANGED'))
      .find((item) => item.scheduleChange?.nextStartsAt === '2026-08-20T21:00:00+09:00')

    expect(changed).toBeDefined()
    expect(changed?.scheduleChange?.previousStartsAt).toBe('2026-08-03T19:00:00+09:00')
    expect(changed?.severity).toBe('HIGH')
  })

  it('같은 강의를 두 번 옮기면 변경 알림도 두 건 생긴다', async () => {
    await loginAsInstructor()
    for (const scheduledAt of ['2026-08-21T21:00:00+09:00', '2026-08-22T21:00:00+09:00']) {
      await saveLesson({
        sectionId: 'sec-security',
        lessonId: SCHEDULED_LESSON,
        title: 'Spring Security 시작하기',
        description: '',
        scheduledAt,
        materials: [],
      })
    }

    await loginAsStudent()
    const changed = (await studentNotifications('LIVE_SCHEDULE_CHANGED'))
      .filter((item) => item.targets.lessonId === SCHEDULED_LESSON)
      .map((item) => item.scheduleChange?.nextStartsAt)

    // 두 번째 변경이 첫 번째와 같은 중복 키로 묶여 사라지면 학생은 마지막 일정을 모른다.
    expect(changed).toContain('2026-08-21T21:00:00+09:00')
    expect(changed).toContain('2026-08-22T21:00:00+09:00')
  })

  it('강의를 삭제하면 수강 승인 학생에게 일정 취소 알림이 생긴다', async () => {
    await loginAsInstructor()
    await deleteLesson(SCHEDULED_LESSON)

    await loginAsStudent()
    const canceled = (await studentNotifications('LIVE_CANCELED'))
      .find((item) => item.targets.lessonId === SCHEDULED_LESSON)

    expect(canceled).toBeDefined()
    expect(canceled?.title).toBe('라이브 강의가 취소되었습니다.')
  })

  it('같은 자료를 다시 등록해도 자료 알림은 한 건만 남는다', async () => {
    publishMaterialPublished(SCHEDULED_LESSON, 'mat-dup-check')
    publishMaterialPublished(SCHEDULED_LESSON, 'mat-dup-check')

    await loginAsStudent()
    const materials = (await studentNotifications('MATERIAL_PUBLISHED'))
      .filter((item) => item.targets.materialId === 'mat-dup-check')

    expect(materials).toHaveLength(1)
  })
})
