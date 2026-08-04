import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { getCurriculumDetail } from '@/features/curriculum-detail/curriculumDetailService'
import { authService } from '@/features/auth/authService'
import { createCurriculum } from '@/features/curriculum/curriculumManagementService'
import { getCurriculums } from '@/features/curriculum/curriculumService'

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

  it('mock 설정이 false면 인증과 생성 서비스도 HTTP 구현을 선택한다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { curriculumId: 'cur-created' },
    } as never)
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { userId: 'usr-1', email: 'instructor@example.com', displayName: '강사', role: 'INSTRUCTOR' },
    } as never)

    await expect(authService.getCurrentUser()).resolves.toMatchObject({ email: 'instructor@example.com' })
    expect(getSpy).toHaveBeenCalledWith('/auth/me')
    await expect(createCurriculum({
      title: '새 커리큘럼',
      summary: '요약',
      description: '설명',
      thumbnailAssetId: 'ast_1',
      thumbnailPreviewUrl: 'data:image/png;base64,mock',
      startsAt: null,
      endsAt: null,
    })).resolves.toEqual({ curriculumId: 'cur-created', periodSaved: true })
    // 미리보기용 data URL이 아니라 업로드로 받은 에셋 id가 나간다.
    expect(postSpy).toHaveBeenCalledWith('/instructor/curriculums', {
      title: '새 커리큘럼',
      summary: '요약',
      description: '설명',
      thumbnailAssetId: 'ast_1',
    })
  })

  // 생성 API는 기간을 받지 않는다. 입력한 운영 기간이 사라지지 않도록 PATCH로 이어 붙인다.
  it('운영 기간을 입력하면 생성 직후 기본 정보 PATCH로 기간을 저장한다', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { curriculumId: 'cur-created' } } as never)
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)

    await expect(createCurriculum({
      title: '새 커리큘럼',
      summary: '',
      description: '',
      thumbnailAssetId: null,
      thumbnailPreviewUrl: null,
      startsAt: '2026-08-01T01:00:00.000Z',
      endsAt: '2026-10-15T13:00:00.000Z',
    })).resolves.toEqual({ curriculumId: 'cur-created', periodSaved: true })

    expect(patchSpy).toHaveBeenCalledWith('/instructor/curriculums/cur-created', {
      startsAt: '2026-08-01T01:00:00.000Z',
      endsAt: '2026-10-15T13:00:00.000Z',
    })
  })

  it('기간이 비어 있으면 불필요한 PATCH를 보내지 않는다', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { curriculumId: 'cur-created' } } as never)
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)

    await createCurriculum({
      title: '새 커리큘럼',
      summary: '',
      description: '',
      thumbnailAssetId: null,
      thumbnailPreviewUrl: null,
      startsAt: null,
      endsAt: null,
    })

    expect(patchSpy).not.toHaveBeenCalled()
  })

  // 초안은 이미 만들어졌으므로 실패를 예외로 올리면 화면이 "생성 실패"로 보여 중복 생성을 부른다.
  it('기간 PATCH만 실패하면 초안 생성은 성공으로 두고 periodSaved로 알린다', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { curriculumId: 'cur-created' } } as never)
    vi.spyOn(apiClient, 'patch').mockRejectedValue(new ApiError('일시적인 오류입니다.', 500, 'INTERNAL_ERROR'))

    await expect(createCurriculum({
      title: '새 커리큘럼',
      summary: '',
      description: '',
      thumbnailAssetId: null,
      thumbnailPreviewUrl: null,
      startsAt: '2026-08-01T01:00:00.000Z',
      endsAt: null,
    })).resolves.toEqual({ curriculumId: 'cur-created', periodSaved: false })
  })

  it('상세 응답의 누락 필드를 보정하고 라이브 상태를 내부 모델로 정규화한다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        curriculumId: 'cur_contract',
        title: '계약 커리큘럼',
        summary: '요약',
        description: '설명',
        thumbnailUrl: null,
        lifecycleStatus: 'PUBLISHED',
        period: null,
        // 프로필을 안 채운 강사는 서버가 bio를 null로 준다(InstructorDirectoryService.toView).
        instructor: {
          instructorId: 'usr_instructor',
          displayName: '강사',
          bio: null,
        },
        outline: [
          {
            sectionId: 'sec_1',
            title: '섹션',
            description: null,
            order: 1,
            lessons: [
              {
                lessonId: 'les_1',
                title: '강의',
                order: 1,
                status: 'PUBLISHED',
                liveSession: {
                  sessionId: 'ses_1',
                  liveSessionStatus: 'SCHEDULED',
                  scheduledAt: '2026-08-01T10:00:00+09:00',
                },
                replayStatus: 'NOT_READY',
              },
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
    expect(detail.materials).toEqual([])
    // 화면 모델은 bio를 string으로 약속한다 — null이 그대로 새면 강사 정보 드롭다운이 던져 상세가 빈 화면이 된다.
    expect(detail.instructor).toEqual({
      instructorId: 'usr_instructor',
      displayName: '강사',
      bio: '',
      expertise: [],
    })
    expect(detail.outline[0].lessons[0].access.allowed).toBe(false)
    expect(detail.outline[0].lessons[0].status).toBe('PUBLISHED')
    expect(detail.outline[0].lessons[0].liveSession).toEqual({
      sessionId: 'ses_1',
      status: 'SCHEDULED',
      scheduledAt: '2026-08-01T10:00:00+09:00',
    })
    expect(detail.outline[0].lessons[0].replayStatus).toBe('NOT_READY')
  })

})
