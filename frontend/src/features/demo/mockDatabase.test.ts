import { beforeEach, describe, expect, it } from 'vitest'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuth'
import { getMockCurriculumDetail, cancelMockEnrollment, enrollMockCurriculum } from '@/features/curriculum-detail/mockCurriculumDetails'
import { getMockCurriculums } from '@/features/curriculum/mockCurriculums'
import {
  getDemoInstructorCurriculums,
  getDemoPendingStudentCurriculums,
  getDemoStudentCurriculums,
  getDemoTodayInstructorLiveSession,
} from './demoData'

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
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    await enrollMockCurriculum('cur-ux-research')
    expect((await getMockCurriculumDetail('cur-ux-research')).viewerContext.relationship).toBe('PENDING_ENROLLMENT')
    expect(
      (await getMockCurriculums({ page: 0, size: 20 })).items
        .find((item) => item.curriculumId === 'cur-ux-research')?.viewerContext.relationship,
    ).toBe('PENDING_ENROLLMENT')

    await cancelMockEnrollment('cur-ux-research')
    expect((await getMockCurriculumDetail('cur-ux-research')).viewerContext.relationship).toBe('UNENROLLED_STUDENT')
  })

  it('강사 소유권은 배열 위치가 아니라 instructorId로 결정한다', async () => {
    const instructor = await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    const dashboard = getDemoInstructorCurriculums(instructor.userId)
    const catalog = await getMockCurriculums({ page: 0, size: 20 })

    expect(dashboard.map((curriculum) => curriculum.curriculumId)).toEqual(['cur-spring-live', 'cur-architecture'])
    expect(catalog.items.find((item) => item.curriculumId === 'cur-spring-live')?.viewerContext.relationship).toBe('OWNER_INSTRUCTOR')
    expect(catalog.items.find((item) => item.curriculumId === 'cur-data-story')?.viewerContext.relationship).toBe('NON_OWNER_INSTRUCTOR')
  })

  it('강사 대시보드 라이브는 당일 일정만 반환한다', async () => {
    const instructor = await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    const todayLive = getDemoTodayInstructorLiveSession(
      instructor.userId,
      new Date('2026-08-03T12:00:00+09:00'),
    )
    const anotherDayLive = getDemoTodayInstructorLiveSession(
      instructor.userId,
      new Date('2026-08-04T12:00:00+09:00'),
    )

    expect(todayLive?.curriculumId).toBe('cur-spring-live')
    expect(todayLive?.sectionId).toBeTruthy()
    expect(todayLive?.lessonId).toBeTruthy()
    expect(anotherDayLive).toBeNull()
  })
})
