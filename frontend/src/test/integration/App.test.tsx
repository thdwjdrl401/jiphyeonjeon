import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { httpAuthService } from '@/features/auth/authService'
import { resetMockAuth } from '@/features/auth/mockAuthService'
import { apiClient } from '@/shared/api/client'

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('LiveClass AI 공개 페이지', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it('웰컴 페이지에서 핵심 가치와 추천 커리큘럼을 보여준다', async () => {
    renderAt('/')

    expect(screen.getByRole('heading', { name: '집현전 LIVECLASS AI' })).toBeInTheDocument()
    expect(screen.getByText('수업은 지나가도,')).toBeInTheDocument()
    expect(screen.getByText('배움은 남도록.')).toBeInTheDocument()
    expect(screen.getByText('몰입하는 라이브 수업')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot' }),
    ).toBeInTheDocument()
  })

  it('커리큘럼 검색 조건을 URL에 보존하고 결과를 갱신한다', async () => {
    const user = userEvent.setup()
    renderAt('/curriculums')

    const search = screen.getByPlaceholderText('제목과 소개로 검색')
    await user.type(search, 'WebRTC')
    await user.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => expect(window.location.search).toContain('q=WebRTC'))
    expect(
      await screen.findByRole('heading', { name: 'WebRTC와 실시간 미디어' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/총/)).toHaveTextContent('1개의 커리큘럼')
  })

  it('커리큘럼 상세 경로를 실제 앱 라우터에서 연다', async () => {
    renderAt('/curriculums/cur-spring-live')

    expect(
      await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '커리큘럼 목차' })).toBeInTheDocument()
  })

  it('로그인 필수 입력을 검증한다', async () => {
    const user = userEvent.setup()
    renderAt('/login')

    const form = await screen.findByRole('form', { name: '로그인' })
    await user.click(within(form).getByRole('button', { name: '로그인' }))

    expect(screen.getByText('이메일을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('비밀번호를 입력해 주세요.')).toBeInTheDocument()
  })

  it('로그인 후 커리큘럼 탐색으로 이동하고 프로필 기본 정보를 팝오버로 표시한다', async () => {
    const user = userEvent.setup()
    renderAt('/login')
    const form = await screen.findByRole('form', { name: '로그인' })

    await user.type(within(form).getByLabelText('이메일'), 'student01@example.com')
    await user.type(within(form).getByLabelText('비밀번호'), 'password1')
    await user.click(within(form).getByRole('button', { name: '로그인' }))

    expect((await screen.findAllByText('김학생')).length).toBeGreaterThan(0)
    expect(window.location.pathname).toBe('/curriculums')
    expect(localStorage.getItem('accessToken')).toBeNull()

    await user.click(screen.getByRole('button', { name: /김학생/ }))
    const profileSummary = screen.getByRole('dialog', { name: '기본 정보' })
    expect(within(profileSummary).getByText('student01@example.com')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/curriculums')

    await user.click(screen.getByRole('heading', { name: '전체 커리큘럼' }))
    expect(screen.queryByRole('dialog', { name: '기본 정보' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '마이페이지' }))
    expect(screen.getByRole('link', { name: '내 커리큘럼' })).toHaveAttribute('href', '/student/curriculums')
    expect(screen.getByRole('link', { name: '내 프로필' })).toHaveAttribute('href', '/student/profile')
  })

  it('회원가입에서 역할·중복 확인을 거쳐 로그인으로 이동한다', async () => {
    const user = userEvent.setup()
    renderAt('/signup')
    const form = await screen.findByRole('form', { name: '회원가입' })

    await user.click(within(form).getByRole('button', { name: /학생으로 배우기/ }))
    await user.type(within(form).getByLabelText(/닉네임/), '김라이브')
    await user.type(within(form).getByLabelText(/이메일/), 'newstudent01@example.com')
    await user.click(within(form).getByRole('button', { name: '중복 확인' }))
    expect(await screen.findByText('사용할 수 있는 이메일입니다.')).toBeInTheDocument()
    await user.type(within(form).getByLabelText(/^비밀번호 \*/), 'password1')
    await user.type(within(form).getByLabelText(/비밀번호 확인/), 'password1')
    await user.click(within(form).getByLabelText(/LiveClass 이용 안내를 확인했습니다/))
    await user.click(within(form).getByRole('button', { name: /가입하고 시작하기/ }))

    // 가입 완료 알림은 로그인 폼 위 배너가 아니라 토스트로 뜬다.
    const toastRegion = await screen.findByRole('region', { name: '알림' })
    expect(
      await within(toastRegion).findByText(/김라이브님, 가입이 완료됐어요/),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
    // 알림을 띄운 뒤 history state를 지워 새로고침·뒤로가기로 되살아나지 않게 한다.
    expect(window.history.state?.usr ?? null).toBeNull()
  })
})

describe('공유 API 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('API prefix와 HttpOnly 쿠키 전송 옵션을 사용한다', () => {
    expect(apiClient.defaults.baseURL).toBe('/api')
    expect(apiClient.defaults.withCredentials).toBe(true)
  })

  it('인증 API가 이메일 필드와 이메일 중복 확인 경로를 사용한다', async () => {
    const authUser = {
      userId: 'usr_contract',
      email: 'student@example.com',
      displayName: '김학생',
      role: 'STUDENT' as const,
      profileImageUrl: null,
    }
    const loginRequest = {
      email: authUser.email,
      password: 'password1',
    }
    const signupRequest = {
      ...loginRequest,
      displayName: authUser.displayName,
      role: authUser.role,
    }
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: authUser } as never)
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { email: authUser.email, available: true },
    } as never)

    await httpAuthService.login(loginRequest)
    await httpAuthService.signup(signupRequest)
    await httpAuthService.checkEmail(authUser.email)

    expect(postSpy).toHaveBeenNthCalledWith(1, '/auth/login', loginRequest)
    expect(postSpy).toHaveBeenNthCalledWith(2, '/auth/signup', signupRequest)
    expect(getSpy).toHaveBeenCalledWith('/auth/email-availability', {
      params: { email: authUser.email },
    })
  })
})
