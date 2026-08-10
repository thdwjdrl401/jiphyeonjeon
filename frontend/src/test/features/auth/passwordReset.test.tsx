import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '@/features/auth/AuthContext'
import { resetMockAuth } from '@/features/auth/mockAuthService'
import LoginPage from '@/pages/LoginPage'
import PasswordResetRequestPage from '@/pages/PasswordResetRequestPage'
import { ToastProvider } from '@/shared/ui/Toast'

/**
 * 비밀번호 찾기 — 임시 비밀번호를 메일로 보낸다.
 *
 * 화면만 봐서는 알 수 없어 못 박아야 하는 것: **계정 유무를 드러내지 않는다**, 그리고
 * **다음에 할 일(로그인 → 비밀번호 변경)을 안내한다**.
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
    await user.click(screen.getByRole('button', { name: /임시 비밀번호 받기/ }))

    expect(await screen.findByText('임시 비밀번호를 보냈습니다.')).toBeInTheDocument()
    // "그런 계정이 없습니다" 류가 새면 가입자 확인 수단이 된다.
    expect(screen.queryByText(/계정을 찾을 수 없/)).not.toBeInTheDocument()
    expect(screen.queryByText(/가입되지 않은/)).not.toBeInTheDocument()
  })

  it('이메일 형식이 아니면 요청하지 않고 형식 오류를 알린다', async () => {
    const user = userEvent.setup()
    renderAt('/password-reset')

    await user.type(await screen.findByLabelText('이메일'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /임시 비밀번호 받기/ }))

    expect(screen.getByText('올바른 이메일 형식으로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('재설정 링크를 보냈습니다.')).not.toBeInTheDocument()
  })

  it('보낸 뒤에는 다음에 할 일을 알려 준다', async () => {
    // 임시 비밀번호만 받고 끝이 아니다 — 로그인하면 곧바로 변경 화면이 열린다는 걸 미리 말한다.
    const user = userEvent.setup()
    renderAt('/password-reset')

    await user.type(screen.getByLabelText('이메일'), 'student01@example.com')
    await user.click(screen.getByRole('button', { name: /임시 비밀번호 받기/ }))

    expect(await screen.findByText('임시 비밀번호를 보냈습니다.')).toBeInTheDocument()
    expect(screen.getByText(/새 비밀번호를 정하는 화면이 열립니다/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인하러 가기' })).toBeInTheDocument()
  })

})
