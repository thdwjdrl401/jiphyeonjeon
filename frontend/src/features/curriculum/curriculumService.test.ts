import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false }))

import {
  cancelEnrollment,
  enrollInCurriculum,
  getCurriculumDetail,
} from '@/features/curriculum-detail/curriculumDetailService'
import { getCurriculums } from './curriculumService'

describe('커리큘럼 API 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('목록 API에 실제 백엔드가 지원하는 검색·정렬·페이지 조건만 전달한다', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { items: [], page: 0, size: 6, totalElements: 0, totalPages: 0, hasNext: false },
    } as never)

    await getCurriculums({
      q: 'React',
      featured: true,
      lifecycleStatus: 'PUBLISHED',
      sort: 'RECOMMENDED',
      page: 0,
      size: 6,
    })

    expect(getSpy).toHaveBeenCalledWith('/curriculums', {
      params: { q: 'React', sort: 'LATEST', page: 0, size: 6 },
    })
  })

  it('현재 공개 상세 응답에 후속 필드가 없어도 안전한 읽기 전용 상태로 보정한다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        curriculumId: 'cur_contract',
        title: '계약 커리큘럼',
        summary: '요약',
        description: '설명',
        thumbnailUrl: null,
        lifecycleStatus: 'PUBLISHED',
        period: null,
        instructor: {
          instructorId: 'usr_instructor',
          displayName: '강사',
          bio: '',
          expertise: [],
        },
        outline: [
          {
            sectionId: 'sec_1',
            title: '섹션',
            description: null,
            order: 1,
            lessons: [
              { lessonId: 'les_1', title: '레슨', order: 1, lessonStatus: 'PUBLISHED' },
            ],
          },
        ],
      },
    } as never)

    const detail = await getCurriculumDetail('cur_contract')

    expect(apiClient.get).toHaveBeenCalledWith('/curriculums/cur_contract')
    expect(detail.viewerContext).toMatchObject({
      relationship: 'GUEST',
      allowedActions: ['VIEW_DETAIL'],
    })
    expect(detail.outline[0].lessons[0].access.allowed).toBe(false)
  })

  it('수강 신청과 취소도 curriculum 경로를 사용한다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        enrollmentId: 'enr_1',
        curriculumId: 'cur_contract',
        status: 'PENDING',
        requestedAt: '2026-07-20T00:00:00Z',
        approvedAt: null,
      },
    } as never)
    const deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue({} as never)

    await enrollInCurriculum('cur_contract')
    await cancelEnrollment('cur_contract')

    expect(postSpy).toHaveBeenCalledWith('/curriculums/cur_contract/enrollments')
    expect(deleteSpy).toHaveBeenCalledWith('/curriculums/cur_contract/enrollments/me')
  })
})
