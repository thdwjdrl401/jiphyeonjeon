import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import RequirePasswordChangeRoute from '@/features/auth/RequirePasswordChangeRoute'
import type { AuthUser } from '@/features/auth/types'

const useAuth = vi.hoisted(() => vi.fn())
vi.mock('@/features/auth/AuthContext', () => ({ useAuth }))

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: 'usr-1',
    email: 'student01@example.com',
    displayName: '김학생',
    role: 'STUDENT',
    profileImageUrl: null,
    isAdmin: false,
    mustChangePassword: false,
    ...overrides,
  }
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/password-change-required" element={<p>새 비밀번호 화면</p>} />
        <Route element={<RequirePasswordChangeRoute />}>
          <Route path="/student/curriculums" element={<p>내 커리큘럼</p>} />
          <Route path="/curriculums" element={<p>공개 커리큘럼</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

/**
 * 임시 비밀번호를 받은 사람을 붙잡아 두는 게이트.
 *
 * <p>이 게이트가 없으면 임시 비밀번호가 그대로 영구 비밀번호가 된다 — 평문으로 메일함에 남은
 * 값이라, 그 메일이 사는 동안 계정도 열려 있는 셈이다.
 */
describe('RequirePasswordChangeRoute', () => {
  it('임시 비밀번호 상태면 어느 화면을 열어도 변경 화면으로 보낸다', () => {
    useAuth.mockReturnValue({ user: user({ mustChangePassword: true }) })

    renderAt('/student/curriculums')

    expect(screen.getByText('새 비밀번호 화면')).toBeInTheDocument()
    expect(screen.queryByText('내 커리큘럼')).not.toBeInTheDocument()
  })

  it('로그인 뒤 화면만이 아니라 공개 화면에서도 붙잡는다', () => {
    // 화면마다 검사하면 새 화면이 생길 때 빠뜨릴 자리가 늘고, 빠뜨린 것은 조용히 열린 채 남는다.
    useAuth.mockReturnValue({ user: user({ mustChangePassword: true }) })

    renderAt('/curriculums')

    expect(screen.getByText('새 비밀번호 화면')).toBeInTheDocument()
  })

  it('바꾸고 나면 놓아 준다', () => {
    useAuth.mockReturnValue({ user: user({ mustChangePassword: false }) })

    renderAt('/student/curriculums')

    expect(screen.getByText('내 커리큘럼')).toBeInTheDocument()
  })

  it('로그인하지 않은 사람은 붙잡지 않는다', () => {
    // 게스트에게는 바꿀 비밀번호가 없다. 여기서 막으면 로그인 화면조차 못 연다.
    useAuth.mockReturnValue({ user: null })

    renderAt('/curriculums')

    expect(screen.getByText('공개 커리큘럼')).toBeInTheDocument()
  })
})
