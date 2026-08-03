import { beforeEach, describe, expect, it } from 'vitest'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { getMockCurriculumDetail } from '@/features/curriculum-detail/mockCurriculumDetails'
import { getMockCurriculums } from '@/features/curriculum/mockCurriculums'
import { mockEnrollmentService } from '@/features/enrollment/mockEnrollmentService'
import { getMockEnrollment, updateMockEnrollmentStatus } from '@/features/enrollment/mockEnrollmentStore'
import {
  getDemoInstructorCurriculums,
  getDemoPendingStudentCurriculums,
  getDemoStudentCurriculums,
  getDemoUpcomingInstructorLiveSession,
} from '@/features/demo/demoData'
import {
  buildMockCurriculumOutline,
  deleteMockCurriculum,
  getMockCurriculum,
  mockCurriculumEntities,
} from '@/features/demo/mockDatabase'

describe('통합 mock 데이터베이스', () => {
  beforeEach(() => {
    resetMockAuth()
  })

  it('학생의 ACTIVE 수강 목록과 공개 목록·상세 관계가 같은 원본을 사용한다', async () => {
    const student = await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    const dashboard = getDemoStudentCurriculums(student.userId)
    const pendingDashboard = getDemoPendingStudentCurriculums(student.userId)
    const catalog = await getMockCurriculums({ page: 0, size: 20 })
    const activeIds = dashboard.map((curriculum) => curriculum.curriculumId)

    expect(activeIds).toEqual(['cur-spring-live', 'cur-data-story', 'cur-react-system'])
    expect(pendingDashboard.map((curriculum) => curriculum.curriculumId)).toEqual(['cur-sql'])
    for (const curriculumId of activeIds) {
      expect(catalog.items.find((item) => item.curriculumId === curriculumId)?.viewerContext.relationship).toBe('ENROLLED')
      expect((await getMockCurriculumDetail(curriculumId)).viewerContext.relationship).toBe('ENROLLED')
    }
  })

  it('수강 신청·취소 변경을 목록과 상세이 함께 반영한다', async () => {
    const student = await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    const firstEnrollment = await mockEnrollmentService.apply('cur-ux-research')
    expect((await getMockCurriculumDetail('cur-ux-research')).viewerContext.relationship).toBe('PENDING_ENROLLMENT')
    expect(
      (await getMockCurriculums({ page: 0, size: 20 })).items
        .find((item) => item.curriculumId === 'cur-ux-research')?.viewerContext.relationship,
    ).toBe('PENDING_ENROLLMENT')

    await mockEnrollmentService.cancel('cur-ux-research')
    expect(getMockEnrollment(student.userId, 'cur-ux-research')?.status).toBe('CANCELLED')
    expect((await getMockCurriculumDetail('cur-ux-research')).viewerContext.relationship).toBe('UNENROLLED_STUDENT')

    const reappliedEnrollment = await mockEnrollmentService.apply('cur-ux-research')
    expect(reappliedEnrollment.enrollmentId).toBe(firstEnrollment.enrollmentId)
    expect(reappliedEnrollment.status).toBe('PENDING')
  })

  it('IMMEDIATE는 즉시 ACTIVE가 되고 REVOKED 이후 같은 레코드로 재신청한다', async () => {
    const student = await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    const firstEnrollment = await mockEnrollmentService.apply('cur-typescript')
    expect(firstEnrollment.status).toBe('ACTIVE')
    expect(firstEnrollment.enrolledAt).toBe(firstEnrollment.requestedAt)
    expect((await getMockCurriculumDetail('cur-typescript')).viewerContext.relationship).toBe('ENROLLED')

    updateMockEnrollmentStatus(student.userId, 'cur-typescript', 'REVOKED')
    expect((await getMockCurriculumDetail('cur-typescript')).viewerContext.relationship).toBe('UNENROLLED_STUDENT')

    const reappliedEnrollment = await mockEnrollmentService.apply('cur-typescript')
    expect(reappliedEnrollment.enrollmentId).toBe(firstEnrollment.enrollmentId)
    expect(reappliedEnrollment.status).toBe('ACTIVE')
  })

  it('강사 소유권은 배열 위치가 아니라 instructorId로 결정한다', async () => {
    const instructor = await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    const dashboard = getDemoInstructorCurriculums(instructor.userId)
    const catalog = await getMockCurriculums({ page: 0, size: 20 })

    expect(dashboard.map((curriculum) => curriculum.curriculumId)).toEqual(['cur-spring-live', 'cur-architecture'])
    expect(catalog.items.find((item) => item.curriculumId === 'cur-spring-live')?.viewerContext.relationship).toBe('OWNER_INSTRUCTOR')
    expect(catalog.items.find((item) => item.curriculumId === 'cur-data-story')?.viewerContext.relationship).toBe('NON_OWNER_INSTRUCTOR')
  })

  it('초안 커리큘럼만 삭제되고, 공개된 것은 409로 막힌다', async () => {
    const instructor = await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    // cur-architecture는 DRAFT, cur-spring-live는 PUBLISHED 시드다.
    expect(() => deleteMockCurriculum('cur-spring-live')).toThrowError(
      expect.objectContaining({ status: 409, code: 'CURRICULUM_STATE_CONFLICT' }),
    )
    expect(() => deleteMockCurriculum('cur-does-not-exist')).toThrowError(
      expect.objectContaining({ status: 404, code: 'CURRICULUM_NOT_FOUND' }),
    )

    deleteMockCurriculum('cur-architecture')

    expect(getMockCurriculum('cur-architecture')).toBeNull()
    expect(getDemoInstructorCurriculums(instructor.userId).map((curriculum) => curriculum.curriculumId))
      .toEqual(['cur-spring-live'])
  })

  it('삭제한 시드 커리큘럼도 reset하면 되살아난다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    deleteMockCurriculum('cur-architecture')
    expect(getMockCurriculum('cur-architecture')).toBeNull()

    resetMockAuth()   // resetMockDatabase까지 함께 돈다

    expect(getMockCurriculum('cur-architecture')?.lifecycleStatus).toBe('DRAFT')
  })

  /*
    서버는 "오늘"로 거르지 않고 예정/진행 세션 중 가장 이른 하나를 준다
    (CatalogService.nearestLiveSession). mock도 같은 규칙이어야 한다 — 예전에는 당일만
    반환해서, 오늘 일정이 없으면 mock은 null인데 실서버는 다음 세션을 주는 식으로 갈렸다.
    날짜를 인자로 받지 않으므로 "지금"이 언제든 결과가 같다.
  */
  it('강사 대시보드 라이브는 당일로 거르지 않고 가장 이른 예정 세션을 반환한다', async () => {
    const instructor = await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    const upcoming = getDemoUpcomingInstructorLiveSession(instructor.userId)

    expect(upcoming?.curriculumId).toBe('cur-spring-live')
    expect(upcoming?.sectionId).toBeTruthy()
    expect(upcoming?.lessonId).toBeTruthy()
    expect(upcoming?.scheduledAt).toBeTruthy()

    // 이 강사의 모든 예정/진행 세션 중 가장 이른 것이어야 한다.
    const allScheduledAt = mockCurriculumEntities
      .filter((curriculum) => curriculum.instructor.instructorId === instructor.userId)
      .flatMap((curriculum) => buildMockCurriculumOutline(curriculum))
      .flatMap((section) => section.lessons)
      .filter((lesson) => lesson.liveSession && ['SCHEDULED', 'OPEN', 'LIVE'].includes(lesson.liveSession.status))
      .map((lesson) => lesson.liveSession!.scheduledAt)
      .filter((scheduledAt): scheduledAt is string => Boolean(scheduledAt))
    expect(allScheduledAt.length).toBeGreaterThan(1)
    const earliest = allScheduledAt.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b))
    expect(upcoming?.scheduledAt).toBe(earliest)
  })
})
