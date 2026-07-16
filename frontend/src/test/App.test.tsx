import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { resetMockAuth } from '@/features/auth/mockAuth'
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

    expect(
      screen.getByRole('heading', { name: /라이브의 순간을 놓치지 않고/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('몰입하는 라이브 수업')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot' }),
    ).toBeInTheDocument()
  })

  it('커리큘럼 검색 조건을 URL에 보존하고 결과를 갱신한다', async () => {
    const user = userEvent.setup()
    renderAt('/curriculums')

    const search = screen.getByPlaceholderText('제목, 소개, 강사 이름으로 검색')
    await user.type(search, 'WebRTC')
    await user.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => expect(window.location.search).toContain('q=WebRTC'))
    expect(
      await screen.findByRole('heading', { name: 'WebRTC와 실시간 미디어' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/총/)).toHaveTextContent('1개의 커리큘럼')
  })

  it('로그인 필수 입력을 검증한다', async () => {
    const user = userEvent.setup()
    renderAt('/login')

    const form = await screen.findByRole('form', { name: '로그인' })
    await user.click(within(form).getByRole('button', { name: '로그인' }))

    expect(screen.getByText('아이디를 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('비밀번호를 입력해 주세요.')).toBeInTheDocument()
  })

  it('로그인 후 사용자 정보를 헤더에 반영하며 토큰을 저장하지 않는다', async () => {
    const user = userEvent.setup()
    renderAt('/login')
    const form = await screen.findByRole('form', { name: '로그인' })

    await user.type(within(form).getByLabelText('아이디'), 'student01')
    await user.type(within(form).getByLabelText('비밀번호'), 'password1')
    await user.click(within(form).getByRole('button', { name: '로그인' }))

    expect(await screen.findByText('김학생')).toBeInTheDocument()
    expect(localStorage.getItem('accessToken')).toBeNull()
  })

  it('회원가입에서 역할·중복 확인을 거쳐 로그인으로 이동한다', async () => {
    const user = userEvent.setup()
    renderAt('/signup')
    const form = await screen.findByRole('form', { name: '회원가입' })

    await user.click(within(form).getByRole('button', { name: /학생으로 배우기/ }))
    await user.type(within(form).getByLabelText(/이름/), '김라이브')
    await user.type(within(form).getByLabelText(/아이디/), 'newstudent01')
    await user.click(within(form).getByRole('button', { name: '중복 확인' }))
    expect(await screen.findByText('사용할 수 있는 아이디입니다.')).toBeInTheDocument()
    await user.type(within(form).getByLabelText(/^비밀번호 \*/), 'password1')
    await user.type(within(form).getByLabelText(/비밀번호 확인/), 'password1')
    await user.click(within(form).getByRole('button', { name: /가입하고 시작하기/ }))

    expect(
      await screen.findByText(/김라이브님, 가입이 완료됐어요/),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })
})

describe('공유 API 계약', () => {
  it('API prefix와 HttpOnly 쿠키 전송 옵션을 사용한다', () => {
    expect(apiClient.defaults.baseURL).toBe('/api/v1')
    expect(apiClient.defaults.withCredentials).toBe(true)
  })
})
