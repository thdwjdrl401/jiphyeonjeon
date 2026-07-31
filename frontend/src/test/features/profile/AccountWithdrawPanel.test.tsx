import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/features/auth/AuthContext'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import AccountWithdrawPanel from '@/features/profile/AccountWithdrawPanel'
import { profileService } from '@/features/profile/profileService'
import type { UserRole } from '@/features/auth/types'
import { ApiError } from '@/shared/api/client'
import { ToastProvider } from '@/shared/ui/Toast'

/**
 * 탈퇴 차단은 **서버가 권위**다 — 진행 중 라이브가 있으면 `DELETE /me`가 409
 * `AUTH_WITHDRAWAL_BLOCKED`으로 거절한다(`LiveWithdrawalGuard`). 화면이 할 일은 그 실패를
 * 사용자가 읽을 수 있는 자리에 남기는 것이다. 토스트로만 흘리면 왜 실패했는지가 사라진다.
 */
function renderPanel(role: UserRole = 'INSTRUCTOR') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AccountWithdrawPanel role={role} />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

async function agreeAndWithdraw(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: /위 안내 사항을 모두 확인하였으며/ }))
  await user.click(screen.getByRole('button', { name: '회원 탈퇴' }))
}

describe('AccountWithdrawPanel', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    resetMockAuth()
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
  })

  it('진행 중 라이브로 409가 오면 폼 안에 이유를 남긴다', async () => {
    const user = userEvent.setup()
    vi.spyOn(profileService, 'withdrawAccount').mockRejectedValue(
      new ApiError(
        '진행 중인 라이브 강의가 있어 탈퇴할 수 없습니다. 강의를 종료한 뒤 다시 시도해 주세요.',
        409,
        'AUTH_WITHDRAWAL_BLOCKED',
      ),
    )
    renderPanel('INSTRUCTOR')

    await agreeAndWithdraw(user)

    /*
      강사에게는 같은 문구가 안내 목록(`li`)에도 이미 있다 — 그래서 텍스트로 찾으면 둘 다 잡힌다.
      확인해야 하는 것은 "실패 알림이 떴는가"이므로 알림 영역(role=status)만 겨냥한다.
    */
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('먼저 강의를 종료해 주세요')
    })
    // 실패했으므로 동의 상태와 버튼은 그대로 남아 다시 시도할 수 있다.
    expect(screen.getByRole('button', { name: '회원 탈퇴' })).toBeEnabled()
  })

  it('409가 아닌 실패는 서버 메시지를 그대로 보여 준다', async () => {
    const user = userEvent.setup()
    vi.spyOn(profileService, 'withdrawAccount').mockRejectedValue(
      new ApiError('일시적인 오류가 발생했습니다.', 500, 'INTERNAL_ERROR'),
    )
    renderPanel('STUDENT')

    await agreeAndWithdraw(user)

    await waitFor(() => {
      expect(screen.getByText('일시적인 오류가 발생했습니다.')).toBeInTheDocument()
    })
  })

  it('동의 체크박스를 켜기 전에는 탈퇴를 호출하지 않는다', async () => {
    const user = userEvent.setup()
    const withdrawSpy = vi.spyOn(profileService, 'withdrawAccount')
    renderPanel('STUDENT')

    const button = screen.getByRole('button', { name: '회원 탈퇴' })
    expect(button).toBeDisabled()
    await user.click(button)

    expect(withdrawSpy).not.toHaveBeenCalled()
  })

  it('학생에게는 라이브 강의 안내를 보여 주지 않는다', () => {
    renderPanel('STUDENT')

    expect(screen.getByText('동일한 이메일로 언제든지 다시 회원가입할 수 있습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/먼저 강의를 종료해 주세요/)).not.toBeInTheDocument()
  })
})
