import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('전체 페이지 라우트', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  const instructorRoutes = [
    ['/instructor/profile', '내 프로필'],
    ['/instructor/curriculums', '내 커리큘럼'],
    ['/instructor/curriculums/new', '새 커리큘럼 만들기'],
    ['/instructor/curriculums/cur-spring-live/manage', '라이브로 완성하는 Spring Boot'],
    ['/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new', '새 강의 만들기'],
    ['/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security/edit', '강의 수정'],
    ['/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security', 'Spring Security 시작하기'],
    ['/instructor/live-sessions/ses-security-live/preflight', '라이브 시작 전 최종 점검'],
    ['/instructor/live-sessions/ses-security-live/processing', '녹화 처리 현황'],
    ['/instructor/live-sessions/ses-security-live/classroom', 'Spring Security 시작하기'],
    ['/instructor/lessons/les-security/replay', 'Spring Security 시작하기'],
  ] as const

  it.each(instructorRoutes)('%s 화면을 연다', async (path, heading) => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt(path)
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument()
  })

  it.each([
    '/instructor/curriculums/cur-spring-live/manage',
    '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security',
    '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security/edit',
    '/instructor/live-sessions/ses-security-live/preflight',
  ])('강사 작업 화면 %s에 현재 커리큘럼 강의 목록을 표시한다', async (path) => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt(path)
    const navigation = await screen.findByRole('complementary', { name: '커리큘럼 강의 목록' })
    expect(await within(navigation).findByRole('link', { name: '라이브로 완성하는 Spring Boot' })).toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: '내 프로필' })).not.toBeInTheDocument()
  })

  it.each([
    '/instructor/lessons/les-security/live-sessions/new',
    '/instructor/live-sessions/ses-security-live',
    '/instructor/live-sessions/ses-security-live/edit',
  ])('삭제된 라이브 일정·상세 경로 %s를 제공하지 않는다', async (path) => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt(path)
    expect(await screen.findByRole('heading', { name: '요청한 페이지를 찾을 수 없어요' })).toBeInTheDocument()
  })

  it('학생에게도 삭제된 라이브 상세 경로를 제공하지 않는다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live')
    expect(await screen.findByRole('heading', { name: '요청한 페이지를 찾을 수 없어요' })).toBeInTheDocument()
  })

  it('학생 입장 전 점검 화면을 연다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live/prejoin')
    expect(await screen.findByRole('heading', { name: '입장 전 점검' })).toBeInTheDocument()
    const lessonNavigation = screen.getByRole('complementary', { name: '커리큘럼 강의 목록' })
    expect(await within(lessonNavigation).findByRole('link', { name: /Spring Security 시작하기/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(lessonNavigation).queryByRole('link', { name: '내 프로필' })).not.toBeInTheDocument()
  })

  it('강사에게 라이브 운영 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/live-sessions/ses-security-live/classroom')
    expect(await screen.findByText('강사 운영 모드')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '질문' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '강의 종료' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'AI 질문' })).not.toBeInTheDocument()
  })

  it('수강생이 강의실 주소로 직접 접근하면 입장 전 점검으로 이동한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live/classroom')

    expect(await screen.findByRole('heading', { name: '입장 전 점검' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/live-sessions/ses-security-live/prejoin')
  })

  it('수강생은 입장 전 점검을 모두 마친 뒤 라이브 학습 화면으로 이동한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live/prejoin')

    // 자동 점검(자동 재생·네트워크)은 진입 시 자동으로 통과된다.
    // 스피커 테스트는 사용자가 직접 재생하고 결과를 확인해야 한다.
    await user.click(await screen.findByRole('button', { name: /테스트 시작/ }))
    await user.click(await screen.findByRole('button', { name: '네, 잘 들려요' }, { timeout: 3000 }))
    await user.click(await screen.findByRole('link', { name: '라이브 입장' }, { timeout: 3000 }))

    expect(await screen.findByRole('tab', { name: 'AI 질문' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/live-sessions/ses-security-live/classroom')
    expect(screen.getByRole('button', { name: '☆ 북마크' })).toBeInTheDocument()
    expect(screen.queryByText('강사 운영 모드')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '강의 종료' })).not.toBeInTheDocument()
  })

  it('강사에게 다시보기 검수 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/lessons/les-security/replay')
    expect(await screen.findByText('강사 검수 모드')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '콘텐츠 검수' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '학습 통계' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '퀴즈' })).not.toBeInTheDocument()
  })

  it('수강생에게 다시보기 학습 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/lessons/les-security/replay')
    expect(await screen.findByText('학습 진행률 42%')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '퀴즈' })).toBeInTheDocument()
    expect(screen.queryByText('강사 검수 모드')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '콘텐츠 검수' })).not.toBeInTheDocument()
  })

  it('학생 강의 상세는 라이브 강의에서 바로 입장 전 점검으로 연결한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/curriculums/cur-spring-live/sections/sec-security/lessons/les-security')

    expect(await screen.findByRole('heading', { name: '라이브 강의' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '준비 상태' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '입장 점검' })).toHaveAttribute(
      'href',
      '/student/live-sessions/ses-security-live/prejoin',
    )
    const lessonNavigation = screen.getByRole('complementary', { name: '커리큘럼 강의 목록' })
    expect(await within(lessonNavigation).findByRole('link', { name: '라이브로 완성하는 Spring Boot' })).toBeInTheDocument()
    expect(within(lessonNavigation).getByRole('heading', { name: '인증과 인가' })).toBeInTheDocument()
    expect(within(lessonNavigation).getByRole('link', { name: /Spring Security 시작하기/ })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await user.click(within(lessonNavigation).getByRole('link', { name: /Redis 세션과 CSRF/ }))
    expect(await screen.findByRole('heading', { name: 'Redis 세션과 CSRF', level: 1 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/curriculums/cur-spring-live/sections/sec-security/lessons/les-session')
  })

  it('학생의 종료된 강의 상세에는 라이브 대신 다시보기 진행도만 표시한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-orientation')

    expect(await screen.findByRole('heading', { name: '다시보기' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '라이브 강의' })).not.toBeInTheDocument()
    expect(screen.getByText('진행도')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '다시보기' })).toHaveAttribute(
      'href',
      '/student/lessons/les-orientation/replay',
    )
  })

  it('다시보기가 배포되지 않은 종료 강의는 준비 중으로 표시한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-request-flow')

    expect(await screen.findByText('다시 보기 준비 중')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '다시보기' })).not.toBeInTheDocument()
  })

  it('입장 가능 시간 전에는 학생 강의 상세에서 안내를 표시한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-service-layer')

    await user.click(await screen.findByRole('button', { name: '입장 점검' }))
    expect(screen.getByText('강의 시간이 아닙니다.')).toBeInTheDocument()
  })

  it('학생의 강사 전용 라우트 접근을 차단한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/instructor/curriculums/new')
    expect(await screen.findByRole('heading', { name: '강사 전용 기능이에요' })).toBeInTheDocument()
  })

  it('강사의 학생 전용 라우트 접근을 상위 라우트에서 차단한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/student/curriculums')
    expect(await screen.findByRole('heading', { name: '학생 전용 기능이에요' })).toBeInTheDocument()
  })

  it('역할 루트는 해당 역할의 내 커리큘럼으로 이동한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student')
    expect(await screen.findByRole('heading', { name: '내 커리큘럼' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/curriculums')
  })

  it('비로그인 사용자는 보호 페이지에서 로그인으로 이동한다', async () => {
    renderAt('/student/profile')
    expect(await screen.findByRole('heading', { name: '다시 만나서 반가워요' })).toBeInTheDocument()
    expect(window.location.search).toContain('returnTo=%2Fstudent%2Fprofile')
  })
})
