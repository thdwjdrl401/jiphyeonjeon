import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '@/features/auth/AuthContext'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import LoginPage from '@/pages/LoginPage'
import PasswordResetConfirmPage from '@/pages/PasswordResetConfirmPage'
import PasswordResetRequestPage from '@/pages/PasswordResetRequestPage'
import { ToastProvider } from '@/shared/ui/Toast'

/**
 * 비밀번호 재설정 — 서버 구현 전이라 mock 데이터 소스로 흐름을 고정한다.
 *
 * 화면만 봐서는 알 수 없어 못 박아야 하는 것: **계정 유무를 드러내지 않는다**,
 * **토큰이 없으면 폼을 내지 않는다**, **토큰은 1회용이다**.
 */
function renderAt(path: string) {
  window.history.pushState({}, '', path)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/password-reset" element={<PasswordResetRequestPage />} />
              <Route path="/password-reset/confirm" element={<PasswordResetConfirmPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

describe('비밀번호 재설정', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it('로그인 화면에서 재설정 요청 화면으로 갈 수 있다', async () => {
    const user = userEvent.setup()
    renderAt('/login')

    await user.click(await screen.findByRole('link', { name: '비밀번호를 잊으셨나요?' }))

    expect(await screen.findByRole('heading', { name: '비밀번호를 잊으셨나요?' })).toBeInTheDocument()
  })

  it.each([
    ['가입된 이메일', 'student01@example.com'],
    ['가입되지 않은 이메일', 'nobody-here@example.com'],
  ])('%s이어도 같은 안내를 보여 준다(계정 존재 여부 비노출)', async (_label, email) => {
    const user = userEvent.setup()
    renderAt('/password-reset')

    await user.type(await screen.findByLabelText('이메일'), email)
    await user.click(screen.getByRole('button', { name: /재설정 링크 받기/ }))

    expect(await screen.findByText('재설정 링크를 보냈습니다.')).toBeInTheDocument()
    // "그런 계정이 없습니다" 류가 새면 가입자 확인 수단이 된다.
    expect(screen.queryByText(/계정을 찾을 수 없/)).not.toBeInTheDocument()
    expect(screen.queryByText(/가입되지 않은/)).not.toBeInTheDocument()
  })

  it('이메일 형식이 아니면 요청하지 않고 형식 오류를 알린다', async () => {
    const user = userEvent.setup()
    renderAt('/password-reset')

    await user.type(await screen.findByLabelText('이메일'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /재설정 링크 받기/ }))

    expect(screen.getByText('올바른 이메일 형식으로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('재설정 링크를 보냈습니다.')).not.toBeInTheDocument()
  })

  it('토큰 없이 확인 화면에 들어오면 폼을 내지 않는다', async () => {
    renderAt('/password-reset/confirm')

    expect(await screen.findByText('재설정 링크가 올바르지 않습니다.')).toBeInTheDocument()
    expect(screen.queryByLabelText('새 비밀번호')).not.toBeInTheDocument()
  })

  it('발급된 토큰으로 비밀번호를 바꾸면 로그인 화면으로 보낸다', async () => {
    const user = userEvent.setup()
    const { devResetToken } = await mockAuthService.requestPasswordReset('student01@example.com')
    renderAt(`/password-reset/confirm?token=${devResetToken}`)

    await user.type(await screen.findByLabelText('새 비밀번호'), 'newpassword1')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'newpassword1')
    await user.click(screen.getByRole('button', { name: /비밀번호 변경/ }))

    expect(await screen.findByRole('heading', { name: '다시 만나서 반가워요' })).toBeInTheDocument()
  })

  it('같은 토큰은 두 번 통하지 않는다', async () => {
    const user = userEvent.setup()
    const { devResetToken } = await mockAuthService.requestPasswordReset('student01@example.com')
    await mockAuthService.confirmPasswordReset({ token: devResetToken!, newPassword: 'newpassword1' })

    renderAt(`/password-reset/confirm?token=${devResetToken}`)
    await user.type(await screen.findByLabelText('새 비밀번호'), 'newpassword2')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'newpassword2')
    await user.click(screen.getByRole('button', { name: /비밀번호 변경/ }))

    expect(await screen.findByText(/이미 사용되었습니다/)).toBeInTheDocument()
  })

  it('새 비밀번호가 서로 다르면 제출을 막는다', async () => {
    const user = userEvent.setup()
    const { devResetToken } = await mockAuthService.requestPasswordReset('student01@example.com')
    renderAt(`/password-reset/confirm?token=${devResetToken}`)

    await user.type(await screen.findByLabelText('새 비밀번호'), 'newpassword1')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'newpassword2')

    expect(screen.getByText('새 비밀번호가 서로 다릅니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /비밀번호 변경/ })).toBeDisabled()
  })
})
