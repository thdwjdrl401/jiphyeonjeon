import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import {
  cancelEnrollment,
  enrollInCurriculum,
  getInstructorEnrollmentRoster,
  getMyEnrollments,
  transitionEnrollment,
} from '@/features/enrollment/enrollmentService'

const enrollmentResponse = {
  enrollmentId: 'enr_1',
  curriculumId: 'cur_1',
  userId: 'usr_1',
  status: 'PENDING',
  requestedAt: '2026-07-20T00:00:00Z',
  decidedAt: null,
  enrolledAt: null,
}

describe('enrollment HTTP 서비스 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('학생 신청과 취소를 enrollment API로 호출한다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: enrollmentResponse } as never)
    const deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue({
      data: { ...enrollmentResponse, status: 'CANCELLED' },
    } as never)

    await enrollInCurriculum('cur_1')
    await cancelEnrollment('cur_1')

    expect(postSpy).toHaveBeenCalledWith('/curriculums/cur_1/enrollments')
    expect(deleteSpy).toHaveBeenCalledWith('/curriculums/cur_1/enrollments/me')
  })

  it('내 수강 목록을 enrollment 화면 모델로 변환한다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: [{
        enrollmentId: 'enr_1',
        curriculumId: 'cur_1',
        status: 'ACTIVE',
        requestedAt: '2026-07-20T00:00:00Z',
        enrolledAt: '2026-07-21T00:00:00Z',
        curriculum: {
          curriculumId: 'cur_1',
          title: '테스트 커리큘럼',
          summary: '요약',
          thumbnailUrl: null,
          lifecycleStatus: 'PUBLISHED',
          lessonCount: 10,
          instructor: { displayName: '강사' },
          viewerContext: {
            progress: { completedLessonCount: 3, totalLessonCount: 10, progressPercent: 30 },
          },
        },
      }],
    } as never)

    await expect(getMyEnrollments()).resolves.toEqual([
      expect.objectContaining({ enrollmentId: 'enr_1', enrollmentStatus: 'ACTIVE', progress: 30 }),
    ])
    expect(apiClient.get).toHaveBeenCalledWith('/me/enrollments')
  })

  it('강사 로스터 조회와 승인·거절·제적 명령 경로를 사용한다', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        summary: { pending: 0, active: 0, rejected: 0, revoked: 0, cancelled: 0 },
        items: [],
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0,
        hasNext: false,
      },
    } as never)
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: enrollmentResponse } as never)

    await getInstructorEnrollmentRoster('cur_1', { status: 'PENDING', page: 0, size: 20 })
    await transitionEnrollment('cur_1', 'enr_1', 'approve')
    await transitionEnrollment('cur_1', 'enr_1', 'reject')
    await transitionEnrollment('cur_1', 'enr_1', 'revoke')

    expect(getSpy).toHaveBeenCalledWith('/instructor/curriculums/cur_1/enrollments', {
      params: { status: 'PENDING', page: 0, size: 20 },
    })
    expect(postSpy).toHaveBeenCalledWith('/instructor/curriculums/cur_1/enrollments/enr_1/approve')
    expect(postSpy).toHaveBeenCalledWith('/instructor/curriculums/cur_1/enrollments/enr_1/reject')
    expect(postSpy).toHaveBeenCalledWith('/instructor/curriculums/cur_1/enrollments/enr_1/revoke')
  })
})
