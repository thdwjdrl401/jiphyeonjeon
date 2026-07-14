import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { requestLogin } from '@/api/authApi'
import { apiClient } from '@/api/client'

vi.mock('@/api/authApi', () => ({
  requestLogin: vi.fn(),
}))

const mockedRequestLogin = vi.mocked(requestLogin)

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('React 애플리케이션', () => {
  beforeEach(() => {
    mockedRequestLogin.mockReset()
  })

  it('홈 경로를 렌더링한다', () => {
    renderAt('/')
    expect(screen.getByRole('button', { name: '1번 회의 상세 보기' })).toBeInTheDocument()
  })

  it.each([
    ['/history', '지난 회의 이력 페이지'],
    ['/conferences/42', '42번 방 상세 보기 페이지'],
  ])('%s 경로를 렌더링한다', (path, expectedText) => {
    renderAt(path)
    expect(screen.getByText(expectedText)).toBeInTheDocument()
  })

  it('경로에 맞춰 사이드바 메뉴를 활성화하고 이동한다', async () => {
    const user = userEvent.setup()
    renderAt('/')

    const historyButton = screen.getByRole('button', { name: '지난 회의 이력' })
    await user.click(historyButton)

    expect(screen.getByText('지난 회의 이력 페이지')).toBeInTheDocument()
    expect(historyButton).toHaveClass('active')
  })

  it('로그인 필수값을 검증한다', async () => {
    const user = userEvent.setup()
    renderAt('/')

    await user.click(screen.getByRole('button', { name: '로그인' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '로그인' }))

    expect(screen.getByText('Please input ID')).toBeInTheDocument()
    expect(screen.getByText('Please input password')).toBeInTheDocument()
    expect(mockedRequestLogin).not.toHaveBeenCalled()
  })

  it('로그인 payload와 토큰 저장을 검증한다', async () => {
    mockedRequestLogin.mockResolvedValue({
      statusCode: 200,
      message: 'Success',
      accessToken: 'test-token',
    })
    const user = userEvent.setup()
    renderAt('/')

    await user.click(screen.getByRole('button', { name: '로그인' }))
    await user.type(screen.getByLabelText('아이디'), 'liveclass')
    await user.type(screen.getByLabelText('비밀번호'), 'password!1')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '로그인' }))

    await waitFor(() => expect(mockedRequestLogin).toHaveBeenCalledWith({ id: 'liveclass', password: 'password!1' }))
    expect(localStorage.getItem('accessToken')).toBe('test-token')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('저장된 토큰을 앱 시작 시 보존한다', () => {
    localStorage.setItem('accessToken', 'saved-token')
    renderAt('/')
    expect(localStorage.getItem('accessToken')).toBe('saved-token')
  })

  it('저장된 토큰을 공용 Axios Authorization 헤더에 설정한다', async () => {
    localStorage.setItem('accessToken', 'saved-token')

    const response = await apiClient.get('/test', {
      adapter: async (config) => ({
        config,
        data: {},
        headers: {},
        status: 200,
        statusText: 'OK',
      }),
    })

    expect(response.config.headers.Authorization).toBe('Bearer saved-token')
  })

  it('스크롤 하단에서 회의 카드를 추가한다', () => {
    renderAt('/')
    const scrollContainer = screen.getByTestId('conference-scroll')

    Object.defineProperties(scrollContainer, {
      scrollTop: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    fireEvent.scroll(scrollContainer)

    expect(screen.getByRole('button', { name: '16번 회의 상세 보기' })).toBeInTheDocument()
  })
})
