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
    renderDetail('/curriculums/cur_spring_live')

    expect(
      await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/학습 주제 1$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수강 신청' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인하기' })).toBeInTheDocument()
  })

  it('비로그인 사용자가 로그인 CTA를 누르면 returnTo를 보존한 채 로그인으로 이동한다', async () => {
    const user = userEvent.setup()
    renderDetail('/curriculums/cur_spring_live')

    const loginLink = await screen.findByRole('link', { name: '로그인하기' })
    await user.click(loginLink)

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(window.location.search).toContain('returnTo=%2Fcurriculums%2Fcur_spring_live')
  })

  it('미수강 학생에게는 수강 신청 버튼이 보인다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur_data_story')

    expect(await screen.findByRole('button', { name: '수강 신청' })).toBeInTheDocument()
    expect(screen.queryByText('학습 진행률')).not.toBeInTheDocument()
  })

  it('수강생에게는 진행률과 학습 이어가기 CTA가 보인다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur_spring_live')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '이어보기' }).length).toBeGreaterThan(0)
  })

  it('수강 중이지만 아직 레슨을 하나도 듣지 않았다면 수강하기 CTA가 보인다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur_react_system')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '수강하기' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: '이어보기' })).not.toBeInTheDocument()
  })

  it('담당 강사에게만 관리 버튼이 보인다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    const { unmount } = renderDetail('/curriculums/cur_spring_live')

    expect(await screen.findByRole('link', { name: '관리하기' })).toBeInTheDocument()
    unmount()
  })

  it('담당하지 않는 강사에게는 관리 버튼이 보이지 않는다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur_data_story')

    await screen.findByRole('heading', { name: '데이터로 설득하는 시각화' })
    expect(screen.queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
    expect(screen.getByText('다른 강사가 운영하는 커리큘럼이에요')).toBeInTheDocument()
    expect(screen.getByText('이 커리큘럼은 강사 계정으로 수강할 수 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수강 신청' })).not.toBeInTheDocument()
  })

  it('수강 신청 성공 후에는 정책과 무관하게 승인 대기 상태로 갱신된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur_data_story')

    const enrollButton = await screen.findByRole('button', { name: '수강 신청' })
    await user.click(enrollButton)

    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인 대기' })).toBeDisabled()
  })

  it('승인 대기 → 취소 → 재신청까지 버튼이 이어진다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur_sql')

    // 승인 대기 상태: 상단은 상태 표시, 실제 취소는 관계 패널의 버튼이 수행한다
    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인 대기' })).toBeDisabled()
    const cancelButton = screen.getByRole('button', { name: '수강 취소' })
    await user.click(cancelButton)

    // 취소 후 다시 수강 신청 상태로 돌아온다
    expect(await screen.findByRole('button', { name: '수강 신청하기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 신청' })).toBeInTheDocument()
    expect(screen.queryByText('승인 대기 중이에요')).not.toBeInTheDocument()

    // 다시 신청하면 승인 대기 상태로 되돌아간다
    await user.click(screen.getByRole('button', { name: '수강 신청하기' }))
    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '수강 취소' })).toBeInTheDocument()
  })

  it('수강 신청 중에는 버튼이 로딩 상태로 바뀌고 완료되면 정상 반영된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    let resolveEnroll: (value: Awaited<ReturnType<typeof curriculumDetailService.enrollInCurriculum>>) => void = () => {}
    const pending = new Promise<Awaited<ReturnType<typeof curriculumDetailService.enrollInCurriculum>>>((resolve) => {
      resolveEnroll = resolve
    })
    const spy = vi.spyOn(curriculumDetailService, 'enrollInCurriculum').mockReturnValue(pending)

    renderDetail('/curriculums/cur_data_story')
    const enrollButton = await screen.findByRole('button', { name: '수강 신청' })
    await user.click(enrollButton)

    await waitFor(() => expect(screen.getAllByRole('button', { name: /신청 중/ }).length).toBeGreaterThan(0))
    for (const button of screen.getAllByRole('button', { name: /신청 중/ })) {
      expect(button).toBeDisabled()
    }

    resolveEnroll({
      enrollmentId: 'enr_test_loading',
      curriculumId: 'cur_data_story',
      status: 'ACTIVE',
      requestedAt: '2026-07-20T12:00:00+09:00',
      approvedAt: '2026-07-20T12:00:00+09:00',
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

    renderDetail('/curriculums/cur_data_story')
    const enrollButton = await screen.findByRole('button', { name: '수강 신청' })
    await user.click(enrollButton)

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 신청했거나 수강 중이에요.')
    expect(screen.getByRole('button', { name: '수강 신청' })).not.toBeDisabled()
    spy.mockRestore()
  })

  it('존재하지 않는 커리큘럼은 404 안내를 보여준다', async () => {
    renderDetail('/curriculums/cur_does_not_exist')

    expect(await screen.findByText('커리큘럼을 찾을 수 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '커리큘럼 목록으로' })).toBeInTheDocument()
  })

  it('조회 실패 시 재시도 가능한 오류 화면을 보여준다', async () => {
    renderDetail(`/curriculums/${MOCK_ERROR_CURRICULUM_ID}`)

    expect(await screen.findByText('커리큘럼을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})
