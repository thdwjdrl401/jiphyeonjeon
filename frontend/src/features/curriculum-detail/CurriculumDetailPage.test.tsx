import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/features/auth/AuthContext'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuth'
import { ApiError } from '@/shared/api/client'
import CurriculumDetailPage from '@/pages/CurriculumDetailPage'
import LoginPage from '@/pages/LoginPage'
import * as curriculumDetailService from './curriculumDetailService'
import { MOCK_ERROR_CURRICULUM_ID, resetMockCurriculumDetails } from './mockCurriculumDetails'

function renderDetail(path: string) {
  window.history.pushState({}, '', path)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/curriculums/:curriculumId" element={<CurriculumDetailPage />} />
            <Route path="/curriculums" element={<div>커리큘럼 목록 페이지</div>} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

describe('CurriculumDetailPage', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockCurriculumDetails()
    window.history.replaceState({}, '', '/')
  })

  it('비로그인 사용자도 공개 상세 정보를 볼 수 있다', async () => {
    renderDetail('/curriculums/cur-spring-live')

    expect(
      await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1. 오리엔테이션과 개발 환경')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수강 신청' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '커리큘럼 강의 자료' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인하기' })).toBeInTheDocument()
  })

  it('비로그인 사용자가 로그인 CTA를 누르면 returnTo를 보존한 채 로그인으로 이동한다', async () => {
    const user = userEvent.setup()
    renderDetail('/curriculums/cur-spring-live')

    const loginLink = await screen.findByRole('link', { name: '로그인하기' })
    await user.click(loginLink)

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(window.location.search).toContain('returnTo=%2Fcurriculums%2Fcur-spring-live')
  })

  it('내 커리큘럼의 데이터 시각화는 상세에서도 수강 중으로 유지된다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-data-story')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('수강 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '이어보기' })).not.toBeInTheDocument()
  })

  it('수강생에게는 진행률과 수강 상태·취소 CTA가 보인다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.getByText('Spring Boot 커리큘럼 가이드.pptx')).toBeInTheDocument()
    expect(screen.getByText('수강 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
  })

  it('수강 중인 커리큘럼을 취소하면 미수강 상태로 갱신한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    await user.click(await screen.findByRole('button', { name: '수강 취소' }))

    expect(await screen.findByRole('button', { name: '수강 신청하기' })).toBeInTheDocument()
    expect(screen.queryByText('학습 진행률')).not.toBeInTheDocument()
  })

  it('학생 목차에서는 상태 태그를 숨기고 모든 레슨 버튼을 강의 상세로 통일한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    const lessonTitle = await screen.findByRole('link', { name: '1. 오리엔테이션과 개발 환경' })
    expect(lessonTitle).toHaveAttribute(
      'href',
      '/student/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-orientation',
    )
    expect(screen.queryByText('게시됨')).not.toBeInTheDocument()
    expect(screen.queryByText('완료')).not.toBeInTheDocument()
    const detailLinks = screen.getAllByRole('link', { name: '강의 상세' })
    expect(detailLinks.length).toBeGreaterThan(0)
    expect(detailLinks[0]).toHaveAttribute(
      'href',
      '/student/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-orientation',
    )
  })

  it('지난 레슨도 커리큘럼 목차에서는 강의 상세로 연결된다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    await screen.findByText('학습 진행률')
    const detailLinks = screen.getAllByRole('link', { name: '강의 상세' })
    expect(detailLinks.length).toBeGreaterThan(0)
    for (const link of detailLinks) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/student\/curriculums\/.+\/sections\/.+\/lessons\/.+$/))
    }
  })

  it('완료 직후 바로 다음 예정 레슨은 라이브 준비 안내 페이지로 연결된다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    const nextUpLink = await screen.findByRole('link', { name: /^7\. 7강\. 학습 주제 7$/ })
    expect(nextUpLink).toHaveAttribute(
      'href',
      '/student/curriculums/cur-spring-live/sections/cur-spring-live-section-3/lessons/cur-spring-live-lesson-7',
    )
  })

  it('수강 중이지만 아직 레슨을 하나도 듣지 않아도 수강 상태 배지를 보여준다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-react-system')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('수강 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '수강하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '이어보기' })).not.toBeInTheDocument()
  })

  it('담당 강사 목차는 레슨 버튼과 공개·라이브 상태 태그를 단순화한다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    const detailLinks = await screen.findAllByRole('link', { name: '강의 상세' })
    expect(detailLinks.length).toBeGreaterThan(0)
    for (const link of detailLinks) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/instructor\/curriculums\/.+\/sections\/.+\/lessons\/.+$/))
    }
    expect(screen.getAllByText('게시됨').length).toBeGreaterThan(0)
    expect(screen.getAllByText('라이브 일정 준비 중').length).toBeGreaterThan(0)
    expect(screen.getAllByText('라이브 예정').length).toBeGreaterThan(0)
    expect(screen.getAllByText('다시보기 준비 중').length).toBeGreaterThan(0)
    expect(screen.getAllByText('다시보기 가능').length).toBeGreaterThan(0)
    expect(screen.queryByText('입장 가능')).not.toBeInTheDocument()
    expect(screen.queryByText('라이브 진행 중')).not.toBeInTheDocument()
  })

  it('게시되지 않은 레슨의 학생 공개 상태는 준비 중으로 표시한다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-architecture')

    expect((await screen.findAllByText('준비 중')).length).toBeGreaterThan(0)
    expect(screen.queryByText('초안')).not.toBeInTheDocument()
    expect(screen.queryByText('게시 준비')).not.toBeInTheDocument()
  })

  it('담당 강사에게만 관리 버튼이 보인다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    const { unmount } = renderDetail('/curriculums/cur-spring-live')

    expect(await screen.findByRole('link', { name: '관리하기' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.getByText('공통 실습 환경 설정.pptx')).toBeInTheDocument()
    unmount()
  })

  it('담당하지 않는 강사에게는 관리 버튼이 보이지 않는다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-data-story')

    await screen.findByRole('heading', { name: '데이터로 설득하는 시각화' })
    expect(screen.queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
    expect(screen.getByText('다른 강사가 운영하는 커리큘럼이에요')).toBeInTheDocument()
    expect(screen.getByText('이 커리큘럼은 강사 계정으로 수강할 수 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '커리큘럼 강의 자료' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수강 신청' })).not.toBeInTheDocument()
  })

  it('수강 신청 성공 후에는 정책과 무관하게 승인 대기 상태로 갱신된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-ux-research')

    const enrollButton = await screen.findByRole('button', { name: '수강 신청' })
    await user.click(enrollButton)

    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
    expect(screen.getByText('승인 대기')).toBeInTheDocument()
  })

  it('승인 대기 → 취소 → 재신청까지 버튼이 이어진다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-sql')

    // 승인 대기 상태: 상단 상태 배지 옆의 취소 버튼이 동작한다
    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    expect(screen.getByText('승인 대기')).toBeInTheDocument()
    const cancelButton = screen.getByRole('button', { name: '수강 신청 취소' })
    await user.click(cancelButton)

    // 취소 후 다시 수강 신청 상태로 돌아온다
    expect(await screen.findByRole('button', { name: '수강 신청하기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 신청' })).toBeInTheDocument()
    expect(screen.queryByText('승인 대기 중이에요')).not.toBeInTheDocument()

    // 다시 신청하면 승인 대기 상태로 되돌아간다
    await user.click(screen.getByRole('button', { name: '수강 신청하기' }))
    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
  })

  it('수강 신청 중에는 버튼이 로딩 상태로 바뀌고 완료되면 정상 반영된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    let resolveEnroll: (value: Awaited<ReturnType<typeof curriculumDetailService.enrollInCurriculum>>) => void = () => {}
    const pending = new Promise<Awaited<ReturnType<typeof curriculumDetailService.enrollInCurriculum>>>((resolve) => {
      resolveEnroll = resolve
    })
    const spy = vi.spyOn(curriculumDetailService, 'enrollInCurriculum').mockReturnValue(pending)

    renderDetail('/curriculums/cur-ux-research')
    const enrollButton = await screen.findByRole('button', { name: '수강 신청' })
    await user.click(enrollButton)

    await waitFor(() => expect(screen.getAllByRole('button', { name: /신청 중/ }).length).toBeGreaterThan(0))
    for (const button of screen.getAllByRole('button', { name: /신청 중/ })) {
      expect(button).toBeDisabled()
    }

    resolveEnroll({
      enrollmentId: 'enr_test_loading',
      curriculumId: 'cur-ux-research',
      userId: 'usr_test_loading',
      status: 'ACTIVE',
      requestedAt: '2026-07-20T12:00:00+09:00',
      decidedAt: '2026-07-20T12:00:00+09:00',
      enrolledAt: '2026-07-20T12:00:00+09:00',
    })

    await waitFor(() => expect(screen.queryByRole('button', { name: /신청 중/ })).not.toBeInTheDocument())
    spy.mockRestore()
  })

  it('수강 신청이 실패하면 오류 메시지를 보여주고 다시 시도할 수 있다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    const spy = vi
      .spyOn(curriculumDetailService, 'enrollInCurriculum')
      .mockRejectedValue(new ApiError('이미 신청했거나 수강 중이에요.', 409, 'ENROLLMENT_ALREADY_EXISTS'))

    renderDetail('/curriculums/cur-ux-research')
    const enrollButton = await screen.findByRole('button', { name: '수강 신청' })
    await user.click(enrollButton)

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 신청했거나 수강 중이에요.')
    expect(screen.getByRole('button', { name: '수강 신청' })).not.toBeDisabled()
    spy.mockRestore()
  })

  it('존재하지 않는 커리큘럼은 404 안내를 보여준다', async () => {
    renderDetail('/curriculums/cur-does-not-exist')

    expect(await screen.findByText('커리큘럼을 찾을 수 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '커리큘럼 목록으로' })).toBeInTheDocument()
  })

  it('조회 실패 시 재시도 가능한 오류 화면을 보여준다', async () => {
    renderDetail(`/curriculums/${MOCK_ERROR_CURRICULUM_ID}`)

    expect(await screen.findByText('커리큘럼을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})
