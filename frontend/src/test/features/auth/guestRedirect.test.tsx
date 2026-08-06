import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { notifySessionExpired } from '@/shared/api/sessionExpiry'

/**
 * 보호 경로에서 튕겨 나갈 때 <b>어디로 가는가</b>.
 *
 * <p>갈림길은 "왜 게스트가 되었는가" 하나다. 예전에는 이 결정이 네 군데(가드 둘 · 헤더 · 탈퇴 모달)에
 * 흩어져 서로 다른 곳을 가리켰고, 어느 쪽이 마지막에 그리느냐로 <b>회원 탈퇴 목적지가 실행마다
 * 달라졌다.</b> 지금은 `GuestRedirect` 한 곳이 정한다 — 그 규칙을 여기서 고정한다.
 */
async function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('게스트가 보호 경로에서 나갈 때', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it('세션이 없으면 로그인 화면으로 보내고 보던 자리를 담는다', async () => {
    // 주소를 직접 열었거나 만료된 경우다. 로그인하면 보던 곳으로 돌아가고 싶다.
    await renderAt('/student/curriculums')

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(window.location.search).toBe('?returnTo=%2Fstudent%2Fcurriculums')
  })

  it('사용 중 세션이 만료되면 로그아웃 상태로 바꾸고 로그인 화면에 보던 자리를 담는다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    await renderAt('/student/curriculums')
    await screen.findByRole('heading', { name: '내 커리큘럼' })

    act(() => notifySessionExpired())

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(window.location.search).toBe('?returnTo=%2Fstudent%2Fcurriculums')
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument()
  })

  it('스스로 로그아웃하면 랜딩페이지로 보낸다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    await renderAt('/student/curriculums')
    await screen.findByRole('heading', { name: '내 커리큘럼' })

    // 로그아웃은 이제 헤더에 바로 떠 있지 않다 — 프로필 드롭다운을 열어야 나온다.
    await user.click(screen.getByRole('button', { name: /김학생/ }))
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))

    // 방금 나온 화면을 returnTo로 다시 권하지 않는다.
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(window.location.search).toBe('')
  })

  it('회원 탈퇴도 같은 목적지다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    await renderAt('/student/profile')

    await user.click(await screen.findByRole('button', { name: '회원 탈퇴' }))
    const dialog = await screen.findByRole('dialog', { name: '회원 탈퇴' })
    await user.click(within(dialog).getByRole('checkbox', { name: /위 안내 사항을 모두 확인하였으며/ }))
    await user.click(within(dialog).getByRole('button', { name: '탈퇴하기' }))

    // 탈퇴한 사람에게는 돌아갈 계정이 없다 — 로그인 화면으로 보내면 안 된다.
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(window.location.search).toBe('')
  })

  it('다시 로그인하면 만료 취급으로 돌아간다', async () => {
    // 지난번에 스스로 나갔다고 해서, 이번 세션이 끊겼을 때까지 랜딩페이지로 보내면 안 된다.
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    await renderAt('/student/curriculums')
    await screen.findByRole('heading', { name: '내 커리큘럼' })

    // 로그아웃은 이제 헤더에 바로 떠 있지 않다 — 프로필 드롭다운을 열어야 나온다.
    await user.click(screen.getByRole('button', { name: /김학생/ }))
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))

    await user.click(await screen.findByRole('link', { name: '로그인' }))
    await user.type(await screen.findByLabelText('이메일'), 'student01@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'password1')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    await waitFor(() => expect(window.location.pathname).not.toBe('/login'))
  })
})
