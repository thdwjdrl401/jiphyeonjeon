import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'

/**
 * 상단 네비게이션의 역할별 메뉴·활성 표시·프로필 목적지를 확인한다.
 * 메뉴 정의는 `app/router/navigation.ts` 한 곳에 있으므로, 여기서 검증하는 것은
 * "그 정의가 역할에 맞게 화면에 나오는가"와 "하위 라우트에서도 활성이 유지되는가"다.
 */

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

function headerNav() {
  return screen.getByRole('navigation', { name: '주요 메뉴' })
}

/**
 * 헤더의 프로필 링크. 워크스페이스 사이드바에도 "내 프로필" 링크가 있어서 화면 전체에서
 * 찾으면 둘이 잡힌다. role=banner로도 좁힐 수 없다 — 페이지 제목도 <header>라서 banner가
 * 여러 개로 잡힌다. 그래서 전역 헤더 요소를 직접 집는다.
 */
function headerProfileLink() {
  const header = document.querySelector('.global-header')
  if (!(header instanceof HTMLElement)) throw new Error('전역 헤더를 찾지 못했습니다')
  return within(header).getByRole('link', { name: /내 프로필$/ })
}

/** 헤더 메뉴의 라벨 목록. 순서까지 본다 — 권장 구성이 탐색 → 내 커리큘럼 → 만들기 순이다. */
function menuLabels() {
  return within(headerNav()).getAllByRole('link').map((link) => link.textContent)
}

function activeMenuLabels() {
  return within(headerNav())
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)
}

async function loginAsInstructor() {
  await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
}

async function loginAsStudent() {
  await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
}

describe('역할별 상단 네비게이션', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  describe('강사', () => {
    /*
      데모 mock은 강사 계정에 isAdmin도 준다(mockAuthService) — 그래서 운영 콘솔이 뒤에 붙는다.
      운영 콘솔은 가입 역할이 아니라 서버 allowlist가 정하는 별도 축이라 역할 메뉴 뒤에 온다.
    */
    it('탐색·내 커리큘럼·커리큘럼 만들기를 순서대로 내고 운영 권한 메뉴는 뒤에 붙인다', async () => {
      await loginAsInstructor()
      renderAt('/instructor/curriculums')

      await waitFor(() => expect(menuLabels()).toEqual([
        '커리큘럼 탐색', '내 커리큘럼', '커리큘럼 만들기', '운영 콘솔',
      ]))
    })

    it('각 메뉴가 강사용 경로를 가리킨다', async () => {
      await loginAsInstructor()
      renderAt('/instructor/curriculums')

      const nav = await waitFor(() => headerNav())
      expect(within(nav).getByRole('link', { name: '커리큘럼 탐색' })).toHaveAttribute('href', '/curriculums')
      expect(within(nav).getByRole('link', { name: '내 커리큘럼' })).toHaveAttribute('href', '/instructor/curriculums')
      expect(within(nav).getByRole('link', { name: '커리큘럼 만들기' })).toHaveAttribute('href', '/instructor/curriculums/new')
    })

    it.each([
      '/instructor/curriculums',
      '/instructor/curriculums/cur-spring-live/manage',
      '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security',
      '/instructor/live-sessions/ses-security-live/preflight',
    ])('하위 화면 %s에서도 내 커리큘럼이 활성이다', async (path) => {
      await loginAsInstructor()
      renderAt(path)

      await waitFor(() => expect(activeMenuLabels()).toEqual(['내 커리큘럼']))
    })

    it('생성 화면에서는 커리큘럼 만들기만 활성이다', async () => {
      await loginAsInstructor()
      renderAt('/instructor/curriculums/new')

      // 경로가 /instructor/curriculums로 시작하지만 "내 커리큘럼"이 함께 켜지면 안 된다.
      await waitFor(() => expect(activeMenuLabels()).toEqual(['커리큘럼 만들기']))
    })

    it('프로필 영역을 누르면 강사 내 프로필로 간다', async () => {
      const user = userEvent.setup()
      await loginAsInstructor()
      renderAt('/instructor/curriculums')

      await waitFor(() => headerProfileLink())
      await user.click(headerProfileLink())
      expect(window.location.pathname).toBe('/instructor/profile')
    })
  })

  describe('학생', () => {
    it('탐색·내 커리큘럼만 내고 커리큘럼 만들기는 내지 않는다', async () => {
      await loginAsStudent()
      renderAt('/student/curriculums')

      await waitFor(() => expect(menuLabels()).toEqual(['커리큘럼 탐색', '내 커리큘럼']))
      expect(within(headerNav()).queryByRole('link', { name: '커리큘럼 만들기' })).not.toBeInTheDocument()
    })

    it('내 커리큘럼이 학생 학습 목록을 가리킨다', async () => {
      await loginAsStudent()
      renderAt('/student/curriculums')

      const nav = await waitFor(() => headerNav())
      expect(within(nav).getByRole('link', { name: '내 커리큘럼' })).toHaveAttribute('href', '/student/curriculums')
    })

    it('강의 학습 화면에서도 내 커리큘럼이 활성이다', async () => {
      await loginAsStudent()
      renderAt('/student/curriculums/cur-spring-live/sections/sec-security/lessons/les-security')

      await waitFor(() => expect(activeMenuLabels()).toEqual(['내 커리큘럼']))
    })

    it('프로필 영역을 누르면 학생 내 프로필로 간다', async () => {
      const user = userEvent.setup()
      await loginAsStudent()
      renderAt('/student/curriculums')

      await waitFor(() => headerProfileLink())
      await user.click(headerProfileLink())
      expect(window.location.pathname).toBe('/student/profile')
    })

    it('커리큘럼 생성 URL을 직접 열면 강사 전용 안내로 막힌다', async () => {
      await loginAsStudent()
      renderAt('/instructor/curriculums/new')

      expect(await screen.findByRole('heading', { name: '강사 전용 기능이에요', level: 1 })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: '새 커리큘럼 만들기' })).not.toBeInTheDocument()
    })

    it('강사용 관리 화면 URL을 직접 열어도 막힌다', async () => {
      await loginAsStudent()
      renderAt('/instructor/curriculums/cur-spring-live/manage')

      expect(await screen.findByRole('heading', { name: '강사 전용 기능이에요', level: 1 })).toBeInTheDocument()
    })
  })

  describe('공통', () => {
    it('로그인하지 않으면 역할 메뉴 없이 탐색만 낸다', async () => {
      renderAt('/curriculums')

      await waitFor(() => expect(menuLabels()).toEqual(['커리큘럼 탐색']))
      expect(await screen.findByRole('link', { name: '로그인' })).toBeInTheDocument()
    })

    it('로그인하지 않고 내 커리큘럼 URL을 열면 로그인으로 돌린다', async () => {
      renderAt('/student/curriculums')

      await waitFor(() => expect(window.location.pathname).toBe('/login'))
      expect(window.location.search).toContain('returnTo=%2Fstudent%2Fcurriculums')
    })

    it('탐색 화면에서는 커리큘럼 탐색이 활성이다', async () => {
      await loginAsStudent()
      renderAt('/curriculums')

      await waitFor(() => expect(activeMenuLabels()).toEqual(['커리큘럼 탐색']))
    })

    it('로그아웃하면 이전 역할의 메뉴가 남지 않는다', async () => {
      const user = userEvent.setup()
      await loginAsInstructor()
      renderAt('/instructor/curriculums')

      await waitFor(() => expect(menuLabels()).toContain('커리큘럼 만들기'))
      await user.click(screen.getByRole('button', { name: '로그아웃' }))

      await waitFor(() => expect(menuLabels()).toEqual(['커리큘럼 탐색']))
    })

    it('프로필 화면에서는 프로필 영역이 현재 위치로 표시된다', async () => {
      await loginAsStudent()
      renderAt('/student/profile')

      const profileLink = await waitFor(() => headerProfileLink())
      expect(profileLink).toHaveAttribute('aria-current', 'page')
      // 프로필은 역할 메뉴 축이 아니므로 메뉴 쪽은 아무것도 켜지지 않는다.
      expect(activeMenuLabels()).toEqual([])
    })

    it('메뉴와 프로필 영역을 키보드로 순서대로 짚을 수 있다', async () => {
      const user = userEvent.setup()
      await loginAsInstructor()
      renderAt('/instructor/curriculums')

      const nav = await waitFor(() => headerNav())
      const explore = within(nav).getByRole('link', { name: '커리큘럼 탐색' })
      explore.focus()
      expect(explore).toHaveFocus()

      await user.tab()
      expect(within(nav).getByRole('link', { name: '내 커리큘럼' })).toHaveFocus()
      await user.tab()
      expect(within(nav).getByRole('link', { name: '커리큘럼 만들기' })).toHaveFocus()
      await user.tab()
      expect(within(nav).getByRole('link', { name: '운영 콘솔' })).toHaveFocus()
      await user.tab()
      expect(headerProfileLink()).toHaveFocus()
    })
  })
})
