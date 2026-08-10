import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PasswordChangeRequiredPage from '@/pages/PasswordChangeRequiredPage'

const replaceTemporaryPassword = vi.hoisted(() => vi.fn(async () => {}))
const refreshUser = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/features/profile/profileService', () => ({
  profileService: { replaceTemporaryPassword },
}))
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ refreshUser }) }))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/password-change-required']}>
      <PasswordChangeRequiredPage />
    </MemoryRouter>,
  )
}

describe('새 비밀번호 설정 화면', () => {
  it('임시 비밀번호를 다시 묻지 않는다', () => {
    /*
     * 방금 그 값으로 로그인해 세션이 섰다. 이미 증명된 것을 한 번 더 치게 하면 "방금 친 걸 왜 또
     * 치지"에서 막힌다 — 서버도 같은 이유로 이 경로에서만 현재 비밀번호를 요구하지 않는다.
     */
    renderPage()

    expect(screen.queryByLabelText(/임시 비밀번호/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('새 비밀번호')).toBeInTheDocument()
    expect(screen.getByLabelText('새 비밀번호 확인')).toBeInTheDocument()
  })

  it('입력칸이 인증 화면의 껍데기 안에 들어간다', () => {
    /*
     * `.input-shell` 없이 맨 input을 두면 인증 화면의 입력 스타일이 하나도 걸리지 않아 레이아웃이
     * 통째로 무너진다(auth.css는 `.input-shell input`에 모든 규칙을 건다). 실제로 그렇게 깨졌다.
     */
    const { container } = renderPage()

    for (const id of ['new-password', 'confirm-password']) {
      expect(container.querySelector(`#${id}`)?.closest('.input-shell')).not.toBeNull()
    }
  })

  it('두 비밀번호가 다르면 보내지 않는다', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('새 비밀번호'), 'brand-new-password')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'something-else')

    expect(screen.getByText('두 비밀번호가 서로 다릅니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /새 비밀번호로 바꾸기/ })).toBeDisabled()
  })

  it('새 비밀번호만 보내고 서버 상태를 다시 읽는다', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('새 비밀번호'), 'brand-new-password')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'brand-new-password')
    await user.click(screen.getByRole('button', { name: /새 비밀번호로 바꾸기/ }))

    expect(replaceTemporaryPassword).toHaveBeenCalledWith('brand-new-password')
    // 다시 읽지 않으면 게이트가 계속 이 화면으로 돌려보낸다.
    expect(refreshUser).toHaveBeenCalled()
  })
})
