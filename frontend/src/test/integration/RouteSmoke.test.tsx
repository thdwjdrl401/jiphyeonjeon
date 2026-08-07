import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FROZEN_NOW } from '@/test/setup'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import type { LiveSessionService } from '@/features/live-session/liveSessionService.interface'
import {
  mockLiveSessionService,
  resetMockLiveSessions,
} from '@/features/live-session/mockLiveSessionService'

vi.mock('@/features/live-session/PlaybackPlayer', () => ({
  default: ({
    playback,
    lessonTitle,
    backLink,
    headerExtra,
  }: {
    playback: { sessionId: string } | null
    lessonTitle?: string
    backLink?: ReactNode
    headerExtra?: ReactNode
  }) => (
    <div aria-label="강의 영상" role="region">
      {backLink}
      {lessonTitle && <h1>{lessonTitle}</h1>}
      {playback && <span>Mock HLS 재생 준비 · {playback.sessionId}</span>}
      {headerExtra}
    </div>
  ),
}))

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

/**
 * 강의 목차 사이드바의 구조 지문. 두 화면이 "같은 사이드바"인지를 aria-label 하나가 아니라
 * 실제로 그려진 것 — 머스트헤드·커리큘럼 제목·섹션 구분·강의 순서·현재 강의 강조 — 으로 비교한다.
 * 사이드바를 새로 만들거나 갈라지면 이 지문이 어긋난다.
 */
async function readLessonIndexSignature() {
  const sidebar = await screen.findByRole('complementary', { name: '커리큘럼 강의 목록' })
  await within(sidebar).findByRole('link', { name: '라이브로 완성하는 Spring Boot' })
  return {
    masthead: sidebar.querySelector('.workspace-sidebar__masthead')?.textContent,
    curriculum: within(sidebar).getByRole('link', { name: '라이브로 완성하는 Spring Boot' }).textContent,
    sections: within(sidebar).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    lessons: Array.from(sidebar.querySelectorAll('.lesson-navigation__lessons a')).map((lesson) => ({
      text: lesson.textContent,
      current: lesson.getAttribute('aria-current'),
    })),
  }
}

describe('전체 페이지 라우트', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockLiveSessions()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const instructorRoutes = [
    ['/instructor/profile', '내 프로필'],
    ['/instructor/curriculums', '커리큘럼 관리'],
    ['/instructor/curriculums/new', '새 커리큘럼 만들기'],
    ['/instructor/curriculums/cur-spring-live/manage', '라이브로 완성하는 Spring Boot'],
    ['/instructor/curriculums/cur-spring-live/sections/sec-security/recorded-lessons/new', '녹화강의 업로드'],
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

  /**
   * 두 점검 화면은 커리큘럼 상세(강의 선택 시 가는 화면)와 **같은 사이드바 컴포넌트**를 쓴다.
   * 별도 사이드바를 만들거나 스타일·순서·강조 방식이 갈리면 여기서 잡힌다.
   * 세션 ses-security-live가 걸린 강의가 les-security라 활성 강의까지 같아야 한다.
   */
  it.each([
    ['강사 최종 점검', '/instructor/live-sessions/ses-security-live/preflight', 'instructor@liveclass.ai'],
    ['학생 입장 전 점검', '/student/live-sessions/ses-security-live/prejoin', 'student01@example.com'],
  ])('%s의 사이드바가 커리큘럼 상세의 강의 목차와 구조가 같다', async (_name, path, email) => {
    await mockAuthService.login({ email, password: 'password1' })
    const rolePath = email.startsWith('instructor')
      ? '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security'
      : '/student/curriculums/cur-spring-live/sections/sec-security/lessons/les-security'

    const detail = renderAt(rolePath)
    const expected = await readLessonIndexSignature()
    detail.unmount()

    const precheck = renderAt(path)
    expect(await readLessonIndexSignature()).toEqual(expected)
    precheck.unmount()

    // 목차가 비어 있으면 위 비교가 무의미하게 통과한다 — 실제 내용이 있었음을 못 박는다.
    expect(expected.masthead).toBe('LESSONINDEX')
    expect(expected.sections.length).toBeGreaterThan(0)
    expect(expected.lessons.filter((lesson) => lesson.current === 'page')).toHaveLength(1)
  })

  it.each([
    '/instructor/lessons/les-security/live-sessions/new',
    '/instructor/live-sessions/ses-security-live/edit',
  ])('삭제된 라이브 일정·상세 경로 %s를 제공하지 않는다', async (path) => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt(path)
    expect(await screen.findByRole('heading', { name: '요청한 페이지를 찾을 수 없어요' })).toBeInTheDocument()
  })

  // 강사가 올린 화질이 수강생이 보는 화질의 상한이라, 이 선택은 사전 점검에서 눈에 보여야 한다.
  // 기본은 최고 화질이고 강사는 낮추는 방향으로만 조정한다.
  it('사전 점검에서 송출 품질을 고르고 선택이 유지된다', async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/live-sessions/ses-security-live/preflight')

    await screen.findByRole('heading', { name: '라이브 시작 전 최종 점검' })
    const breadcrumbs = screen.getByRole('navigation', { name: '강의 경로' })
    expect(within(breadcrumbs).getByRole('link', { name: 'Spring Security 시작하기' })).toHaveAttribute(
      'href',
      '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security',
    )
    expect(within(breadcrumbs).queryByText('사전 점검')).not.toBeInTheDocument()
    const camera = await screen.findByRole('group', { name: '카메라' })
    const fullHd = within(camera).getByRole('radio', { name: /1080p/ })
    expect(fullHd).toBeChecked()

    await user.click(within(camera).getByRole('radio', { name: /720p/ }))
    expect(within(camera).getByRole('radio', { name: /720p/ })).toBeChecked()
    expect(fullHd).not.toBeChecked()

    // 같은 장비로 반복해 강의하므로 다음 세션에도 그대로 적용돼야 한다.
    expect(JSON.parse(window.localStorage.getItem('liveclass.publishQuality') ?? '{}'))
      .toMatchObject({ camera: 'hd' })
  })

  it('사전 점검의 서버 점검 결과를 버튼이 아닌 자동 상태 안내로 표시한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/live-sessions/ses-security-live/preflight')

    expect(
      await screen.findByText('서버 점검 완료 · 강사 연결이 정상입니다.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /서버 점검|최신 상태 점검/ })).not.toBeInTheDocument()
  })

  it('강사 세션 루트는 연결을 소유하는 preflight로 이동한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/live-sessions/ses-security-live')
    expect(await screen.findByRole('heading', { name: '라이브 시작 전 최종 점검' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/instructor/live-sessions/ses-security-live/preflight')
  })

  it('학생에게도 삭제된 라이브 상세 경로를 제공하지 않는다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live')
    expect(await screen.findByRole('heading', { name: '요청한 페이지를 찾을 수 없어요' })).toBeInTheDocument()
  })

  /*
    브라우저 푸시가 여는 자리다. 서비스워커는 로그인 세션도 역할도 모르므로 역할 없는 `/notifications`로
    열고, 앱이 그 사람의 알림함으로 넘긴다. 이 라우트가 없으면 푸시 클릭이 `*`에 걸려 404가 떴다 —
    알림을 눌렀는데 "페이지를 찾을 수 없어요"가 뜨는 것은 알림이 깨진 것과 구별되지 않는다.
  */
  it('푸시 알림이 여는 역할 없는 알림함 경로를 학생 알림함으로 넘긴다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/notifications')
    await waitFor(() => expect(window.location.pathname).toBe('/student/notifications'))
  })

  it('강사가 푸시 알림을 누르면 강사 알림함으로 간다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/notifications')
    await waitFor(() => expect(window.location.pathname).toBe('/instructor/notifications'))
  })

  it('로그인하지 않은 채 푸시 알림을 누르면 로그인 뒤 알림함으로 돌아오게 한다', async () => {
    renderAt('/notifications')
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/notifications')
  })

  it('학생 입장 전 점검 화면을 연다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live/prejoin')
    expect(await screen.findByRole('heading', { name: '입장 전 점검' })).toBeInTheDocument()
    const breadcrumbs = screen.getByRole('navigation', { name: '강의 경로' })
    expect(within(breadcrumbs).getByRole('link', { name: 'Spring Security 시작하기' })).toHaveAttribute(
      'href',
      '/student/curriculums/cur-spring-live/sections/sec-security/lessons/les-security',
    )
    expect(within(breadcrumbs).queryByText('입장 전 점검')).not.toBeInTheDocument()
    const lessonNavigation = screen.getByRole('complementary', { name: '커리큘럼 강의 목록' })
    expect(await within(lessonNavigation).findByRole('link', { name: /Spring Security 시작하기/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(lessonNavigation).queryByRole('link', { name: '내 프로필' })).not.toBeInTheDocument()
  })

  it('강사에게 라이브 운영 화면을 제공한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    await mockLiveSessionService.startLiveSession('ses-security-live')
    await mockLiveSessionService.getLiveStartStatus('ses-security-live')
    renderAt('/instructor/live-sessions/ses-security-live/classroom')
    const liveInformation = await screen.findByRole('banner', { name: '라이브 강의 정보' })
    expect(within(liveInformation).getByText('강사 운영 모드')).toBeInTheDocument()
    expect(await within(liveInformation).findByText('Mock 송출 모드')).toBeInTheDocument()
    expect(within(liveInformation).getByText(/명 참여 중/)).toBeInTheDocument()
    expect(document.querySelector('.presenter-card')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '채팅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '실시간 노트' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI 질문' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '핵심 용어' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '강의 종료' })).toBeInTheDocument()
    expect(screen.queryByLabelText('라이브 타임라인')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'LIVE' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '확인하고 참여하기' }))
    expect(within(liveInformation).getByText('Mock 송출 모드')).toBeInTheDocument()
    const cameraToggle = screen.getByRole('button', { name: '카메라 켜짐' })
    expect(cameraToggle).toHaveAttribute('aria-pressed', 'true')
    await user.click(cameraToggle)
    expect(screen.getByRole('button', { name: '카메라 꺼짐' })).toHaveAttribute('aria-pressed', 'false')

    const chatInput = screen.getByLabelText('채팅 메시지')
    await user.type(chatInput, '첫째 줄')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.type(chatInput, '둘째 줄')
    expect(chatInput).toHaveValue('첫째 줄\n둘째 줄')
    await user.keyboard('{Enter}')
    expect(chatInput).toHaveValue('')
    expect(await screen.findByText((text) => text.includes('첫째 줄') && text.includes('둘째 줄'))).toBeInTheDocument()

    // 강사 화면에는 자막 독이 없다. 자기가 말한 것을 다시 읽을 이유가 없고, 자막이 차지하는 높이만큼
    // 실제로 나가는 프레임을 작게 보게 된다. 자막은 수강생 화면에만 둔다.
    expect(screen.queryByRole('region', { name: '실시간 자막' })).not.toBeInTheDocument()
    expect(screen.queryByText(/SecurityContext가 현재 요청의 사용자 정보를 보관합니다/)).not.toBeInTheDocument()

    // 용어는 자막이 아니라 핵심 용어 탭으로 확인한다.
    await user.click(screen.getByRole('tab', { name: '핵심 용어' }))
    expect(screen.getByRole('tab', { name: '핵심 용어' })).toHaveAttribute('aria-selected', 'true')
    // 하드코딩 예시가 아니라 서버 용어집(ai 원본 + 강사 수정)이 온다.
    expect(await screen.findByText(/현재 요청에서 인증된 사용자와 권한 정보를 보관/)).toBeInTheDocument()
  })

  it('강사가 라이브를 종료하면 녹화 화면 대신 해당 강의 상세로 돌아간다', async () => {
    const user = userEvent.setup()
    const sessionId = 'ses-security-live'
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    await mockLiveSessionService.startLiveSession(sessionId)
    await mockLiveSessionService.getLiveStartStatus(sessionId)
    renderAt(`/instructor/live-sessions/${sessionId}/classroom`)

    await screen.findByRole('banner', { name: '라이브 강의 정보' })
    await user.click(screen.getByRole('button', { name: '확인하고 참여하기' }))
    await user.click(screen.getByRole('button', { name: '강의 종료' }))

    const confirmation = screen.getByRole('alert')
    expect(within(confirmation).getByText(/이 강의의 상세 화면으로 돌아갑니다/)).toBeInTheDocument()
    await user.click(within(confirmation).getByRole('button', { name: '종료하고 강의 상세로 이동' }))

    await waitFor(() => expect(window.location.pathname).toBe(
      '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security',
    ))
    expect(window.location.pathname).not.toContain('/processing')
    expect(window.location.pathname).not.toContain('/replay')
    expect(await screen.findByRole('heading', { name: 'Spring Security 시작하기', level: 1 })).toBeInTheDocument()
  })

  it('강사는 STARTING 동안 preflight에 머물고 LIVE가 된 뒤 같은 세션 classroom으로 이동한다', async () => {
    const user = userEvent.setup()
    const sessionId = 'ses-security-live'
    const session = await mockLiveSessionService.getLiveSession(sessionId)
    const startStatus = vi.spyOn(
      mockLiveSessionService as LiveSessionService,
      'getLiveStartStatus',
    )
      .mockResolvedValueOnce({
        operationId: `op-${sessionId}`,
        attemptStatus: 'IN_PROGRESS',
        step: 'EGRESS_STARTING',
        failureCode: null,
        failureMessage: null,
        session: { ...session, status: 'STARTING' },
      })
      .mockResolvedValueOnce({
        operationId: `op-${sessionId}`,
        attemptStatus: 'SUCCEEDED',
        step: 'LIVE',
        failureCode: null,
        failureMessage: null,
        session: { ...session, status: 'LIVE', participants: Math.max(session.participants, 1) },
      })

    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt(`/instructor/live-sessions/${sessionId}/preflight`)

    const startButton = await screen.findByRole('button', { name: '라이브 시작' })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    expect(await screen.findByText(/STARTING · EGRESS_STARTING/)).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/instructor/live-sessions/${sessionId}/preflight`)
    expect(startStatus).toHaveBeenNthCalledWith(1, sessionId, `op-${sessionId}`)

    expect(
      await screen.findByRole('banner', { name: '라이브 강의 정보' }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/instructor/live-sessions/${sessionId}/classroom`)
    expect(startStatus).toHaveBeenCalledTimes(2)
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
    // 좌 → 우 → 양쪽 3구간을 안내한다(순서·채널 자체는 speakerTest.test.ts가 고정).
    const channels = await screen.findByRole('list', { name: '테스트음 재생 위치' })
    expect(within(channels).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['왼쪽', '오른쪽', '양쪽'])

    await user.click(await screen.findByRole('button', { name: /테스트 시작/ }))
    // 테스트음이 약 5초라(1.55초 차임 × 3구간 + 구간 사이 침묵) 확인 버튼은 그 뒤에 뜬다 —
    // 기본 대기(1초)로는 모자라고, 테스트 전체 제한(5초)도 넘으므로 아래에서 함께 늘렸다.
    await user.click(await screen.findByRole('button', { name: '네, 모두 들려요' }, { timeout: 9_000 }))
    // 점검 화면을 연 뒤 강사가 시작해도, 입장 클릭 시 상태를 다시 조회해 들어간다.
    await mockLiveSessionService.startLiveSession('ses-security-live')
    await mockLiveSessionService.getLiveStartStatus('ses-security-live')
    await user.click(await screen.findByRole('button', { name: '라이브 입장' }))

    expect(await screen.findByRole('tab', { name: 'AI 질문' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '강의 영상' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '채팅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '실시간 노트' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '핵심 용어' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/live-sessions/ses-security-live/classroom')
    await user.click(screen.getByRole('button', { name: '확인하고 참여하기' }))
    expect(await screen.findByText('Mock HLS 재생 준비 · ses-security-live')).toBeInTheDocument()
    expect(screen.queryByText('강사 운영 모드')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '강의 종료' })).not.toBeInTheDocument()

    // 자막 독은 수강생 화면에만 있다(강사 화면 테스트의 반대편). 라인 자체는 재생 위치가 자막 시각에
    // 닿아야 드러나므로(ADR-0045) 여기서는 독의 존재만 확인한다.
    expect(screen.getByRole('region', { name: '실시간 자막' })).toBeInTheDocument()
    // 테스트음(약 5초)을 실제로 기다리는 흐름이라 기본 제한(5초)으로는 끝낼 수 없다.
  })

  /**
   * <b>시작 전에도 들어간다</b>(ADR-0084).
   *
   * <p>예전에는 여기서 "강의가 아직 시작되지 않았습니다" 팝업을 띄우고 돌려보냈다. 그러면 학생은 강사가
   * 시작할 때까지 입장 버튼을 반복해 눌러야 하는데, 예정 시각과 실제 시작 시각은 늘 어긋나므로 그 반복이
   * 기본 동선이 된다. 지금은 들여보내고 <b>강의실 안에서</b> 기다리며, 시작 신호를 받으면 스스로 넘어간다.
   */
  it('강사가 아직 시작하지 않아도 강의실까지 들어가 대기한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live/prejoin')

    await user.click(await screen.findByRole('button', { name: /테스트 시작/ }))
    await user.click(await screen.findByRole('button', { name: '네, 모두 들려요' }, { timeout: 9_000 }))
    await user.click(await screen.findByRole('button', { name: '라이브 입장' }))

    // 막는 팝업이 아니라 강의실이 나와야 한다(녹화 안내 모달이 강의실의 첫 화면이다).
    expect(await screen.findByRole('button', { name: '확인하고 참여하기' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/live-sessions/ses-security-live/classroom')
    // 입장을 막는 팝업은 없어야 한다 — 강의실의 녹화 안내도 dialog라 이름으로 구별한다.
    expect(screen.queryByRole('dialog', { name: '입장할 수 없는 강의입니다' })).not.toBeInTheDocument()
  })

  it('종료된 강의는 기다리라고 하지 않고 입장할 수 없다고 알린다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live/prejoin')

    await user.click(await screen.findByRole('button', { name: /테스트 시작/ }))
    await user.click(await screen.findByRole('button', { name: '네, 모두 들려요' }, { timeout: 9_000 }))
    /*
      점검을 마친 뒤 강의가 끝난 상황이다. 입장 시점에 다시 조회하므로 이때부터 ENDED가 보인다
      — 화면 진입 시점의 가드(isLiveEntryOpen)는 이미 통과해 버렸으므로 이 분기가 필요하다.
    */
    await mockLiveSessionService.endLiveSession('ses-security-live')
    await user.click(await screen.findByRole('button', { name: '라이브 입장' }))

    const dialog = await screen.findByRole('dialog', { name: '입장할 수 없는 강의입니다' })
    expect(within(dialog).getByText(/이미 종료되었거나 취소된 강의입니다/)).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/live-sessions/ses-security-live/prejoin')
  })

  // 시작 전은 이제 통과하므로(ADR-0084) 팝업이 남는 경로는 <b>끝난 강의</b>뿐이다.
  it('입장 안내 팝업은 Escape로도 닫힌다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/live-sessions/ses-security-live/prejoin')

    await user.click(await screen.findByRole('button', { name: /테스트 시작/ }))
    await user.click(await screen.findByRole('button', { name: '네, 모두 들려요' }, { timeout: 9_000 }))
    await mockLiveSessionService.endLiveSession('ses-security-live')
    await user.click(await screen.findByRole('button', { name: '라이브 입장' }))
    await screen.findByRole('dialog', { name: '입장할 수 없는 강의입니다' })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '라이브 입장' })).toHaveFocus()
  })

  it('ENDED 학생 화면은 종료 문구를 표시하되 채팅·AI 질문을 유지한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    await mockLiveSessionService.endLiveSession('ses-security-live')

    renderAt('/student/live-sessions/ses-security-live/classroom')

    expect(await screen.findByText('라이브가 종료된 강의입니다.')).toBeInTheDocument()
    const chatInput = screen.getByLabelText('채팅 메시지')
    expect(chatInput).toBeEnabled()
    await user.type(chatInput, '종료 뒤에도 이어가는 질문')
    await user.click(screen.getByRole('button', { name: '전송' }))
    expect(await screen.findByText('종료 뒤에도 이어가는 질문')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'AI 질문' }))
    expect(screen.getByRole('textbox', { name: 'AI에게 할 질문' })).toBeEnabled()
    expect(await screen.findByText('Mock HLS 재생 준비 · ses-security-live')).toBeInTheDocument()
  })

  it('강사에게 다시보기 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/lessons/les-security/replay')
    expect(await screen.findByText('강사 화면')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '채팅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '실시간 노트' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI 질문' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '핵심 용어' })).toBeInTheDocument()
  })

  it('수강생에게 다시보기 학습 화면을 제공한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/lessons/les-security/replay')
    expect(await screen.findByText('학습 진행률 42%')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '채팅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '실시간 노트' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI 질문' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '핵심 용어' })).toBeInTheDocument()
    expect(screen.queryByText('강사 화면')).not.toBeInTheDocument()
  })

  it('다시보기가 라이브 때 쌓인 노트·AI 기록을 그대로 보여준다', async () => {
    // 다시보기 전용 데이터가 따로 있는 게 아니다 — 세션 단위로 저장된 것을 같은 조회로 읽는다.
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/lessons/les-security/replay')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: '실시간 노트' }))
    // 하드코딩 예시가 아니라 서버가 준 주제가 나온다.
    expect(await screen.findByRole('heading', { name: '요청이 인증되는 전체 흐름' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'AI 질문' }))
    expect(await screen.findByText(/세션과 JWT를 함께 쓰는 기준/)).toBeInTheDocument()
  })

  it('다시보기도 라이브와 같은 재생 계약으로 실제 플레이어를 띄운다', async () => {
    // 목업 재생 컨트롤(▶ 버튼·range 슬라이더)이 아니라 라이브와 같은 플레이어를 쓴다.
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/lessons/les-security/replay')

    expect(await screen.findByRole('region', { name: '강의 영상' })).toBeInTheDocument()
    expect(screen.queryByLabelText('다시보기 타임라인')).not.toBeInTheDocument()
  })

  it('학생 강의 상세는 라이브 강의에서 바로 입장 전 점검으로 연결한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/curriculums/cur-spring-live/sections/sec-security/lessons/les-security')

    expect(await screen.findByRole('heading', { name: '라이브 강의' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '준비 상태' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '입장 점검 시작' })).toHaveAttribute(
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
    const replayProgress = screen.getByRole('progressbar', { name: '다시보기 학습 진행률' })
    expect(replayProgress).toHaveAttribute('aria-valuenow', '100')
    expect(replayProgress.firstElementChild).toHaveStyle({ width: '100%' })
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

  /**
   * "입장 가능 시간 <b>전</b>"이라는 전제는 데모 fixture의 절대 일정(2026-08-03T19:00+09:00)과
   * 지금의 <b>관계</b>다. `isLiveEntryOpen`이 `now >= scheduledAt − 10분`이라, 벽시계가 그 지점을
   * 지나면 버튼이 링크로 바뀌어 이 테스트는 <b>영구히</b> 실패한다 — 재시도로 못 살리는 시한폭탄이고
   * 그 시점은 2026-08-03 18:50 KST였다. 그래서 이 테스트에서만 시계를 그 이전으로 고정한다.
   *
   * <p>전역으로 고정하지 않는 이유는 setup.ts에 적어 뒀다(자체 타이머를 쓰거나 `Date.now()`로 번호를
   * 채는 테스트가 함께 무너진다). `Date`만 고정하고 실제 타이머는 살려 user-event는 그대로 돈다.
   */
  it('입장 가능 시간 전에는 학생 강의 상세에서 안내를 표시한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(FROZEN_NOW)
    try {
      const user = userEvent.setup()
      await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
      renderAt('/student/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-service-layer')

      await user.click(await screen.findByRole('button', { name: '입장 점검 시작' }))
      expect(screen.getByText('강의 시간이 아닙니다.')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('학생의 강사 전용 라우트 접근을 차단한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/instructor/curriculums/new')
    expect(await screen.findByRole('heading', { name: '강사 전용 기능이에요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '내 커리큘럼' })).toHaveAttribute('href', '/student/curriculums')
  })

  it('강사의 학생 전용 라우트 접근을 상위 라우트에서 차단한다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/student/curriculums')
    expect(await screen.findByRole('heading', { name: '학생 전용 기능이에요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '커리큘럼 관리' })).toHaveAttribute('href', '/instructor/curriculums')
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
