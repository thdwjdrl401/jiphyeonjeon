import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuth'

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
    ['/me/profile', '내 프로필'],
    ['/me/curriculums', '내 커리큘럼'],
    ['/curriculums/new', '새 커리큘럼 만들기'],
    ['/curriculums/cur_spring_live/manage', '라이브로 완성하는 Spring Boot'],
    ['/curriculums/cur_spring_live/sections/sec_security/lessons/new', '새 레슨 만들기'],
    ['/curriculums/cur_spring_live/sections/sec_security/lessons/les_security/edit', '레슨 수정'],
    ['/curriculums/cur_spring_live/sections/sec_security/lessons/les_security', 'Spring Security 시작하기'],
    ['/instructor/lessons/les_security/live-sessions/new', '라이브 일정 만들기'],
    ['/instructor/live-sessions/ses_security_live/edit', '라이브 일정 수정'],
    ['/live-sessions/ses_security_live', 'Spring Security 시작하기'],
    ['/instructor/live-sessions/ses_security_live/preflight', '라이브 시작 전 최종 점검'],
    ['/instructor/live-sessions/ses_security_live/processing', '녹화 처리 현황'],
    ['/live-sessions/ses_security_live/classroom', 'Spring Security 시작하기'],
    ['/lessons/les_security/replay', 'Spring Security 시작하기'],
  ] as const

  it.each(instructorRoutes)('%s 화면을 연다', async (path, heading) => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt(path)
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument()
  })

  it('학생 입장 전 점검 화면을 연다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/live-sessions/ses_security_live/prejoin')
    expect(await screen.findByRole('heading', { name: '입장 전 점검' })).toBeInTheDocument()
  })

  it('강사에게 라이브 운영 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/live-sessions/ses_security_live/classroom')
    expect(await screen.findByText('강사 운영 모드')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '질문' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '세션 종료' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'AI 질문' })).not.toBeInTheDocument()
  })

  it('수강생에게 라이브 학습 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/live-sessions/ses_security_live/classroom')
    expect(await screen.findByRole('tab', { name: 'AI 질문' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '☆ 북마크' })).toBeInTheDocument()
    expect(screen.queryByText('강사 운영 모드')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '세션 종료' })).not.toBeInTheDocument()
  })

  it('강사에게 다시보기 검수 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/lessons/les_security/replay')
    expect(await screen.findByText('강사 검수 모드')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '콘텐츠 검수' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '학습 통계' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '퀴즈' })).not.toBeInTheDocument()
  })

  it('수강생에게 다시보기 학습 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/lessons/les_security/replay')
    expect(await screen.findByText('학습 진행률 42%')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '퀴즈' })).toBeInTheDocument()
    expect(screen.queryByText('강사 검수 모드')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '콘텐츠 검수' })).not.toBeInTheDocument()
  })

  it('학생의 강사 전용 라우트 접근을 차단한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/curriculums/new')
    expect(await screen.findByRole('heading', { name: '강사 전용 기능이에요' })).toBeInTheDocument()
  })

  it('비로그인 사용자는 보호 페이지에서 로그인으로 이동한다', async () => {
    renderAt('/me/profile')
    expect(await screen.findByRole('heading', { name: '다시 만나서 반가워요' })).toBeInTheDocument()
    expect(window.location.search).toContain('returnTo=%2Fme%2Fprofile')
  })
})
