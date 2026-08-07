import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/shared/config/runtime', () => ({
  isMockApiEnabled: false,
  isTestMode: false,
  isNetworkBlocked: false,
}))

const getPushPublicKey = vi.fn()
const registerPushSubscription = vi.fn()
const unregisterPushSubscription = vi.fn()
vi.mock('@/features/notification/notificationService', () => ({
  getPushPublicKey: () => getPushPublicKey(),
  registerPushSubscription: (s: unknown) => registerPushSubscription(s),
  unregisterPushSubscription: (e: string) => unregisterPushSubscription(e),
}))

import BrowserPushPrompt from '@/features/notification/BrowserPushPrompt'
import { wasBrowserPushPromptDismissedRecently } from '@/features/notification/browserPushPromptStorage'

/**
 * 대시보드 사이트 자체 안내.
 *
 * <p>지키려는 것은 셋이다 — <b>다섯 조건이 모두 맞을 때만 뜨는가</b>, <b>"켜기"를 누른 순간에만
 * 권한을 묻는가</b>, <b>"나중에"가 이 브라우저에 스누즈를 남기는가</b>.
 */
describe('BrowserPushPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    getPushPublicKey.mockResolvedValue('BFakeKey')
    registerPushSubscription.mockResolvedValue(undefined)
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
  })

  function stubBrowser(permission: 'default' | 'granted' | 'denied') {
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue({
          endpoint: 'https://push.example/abc',
          getKey: () => new Uint8Array([1, 2, 3]).buffer,
        }),
      },
    }
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
      },
    })
    vi.stubGlobal('Notification', {
      permission,
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    vi.stubGlobal('PushManager', function PushManager() {})
  }

  it('알림 받을 가치가 있는 강의가 없으면 뜨지 않는다', async () => {
    stubBrowser('default')

    render(<BrowserPushPrompt eligible={false} />)

    await waitFor(() => expect(getPushPublicKey).toHaveBeenCalled())
    expect(screen.queryByText(/이 브라우저에서 알림을 받을까요/)).not.toBeInTheDocument()
  })

  it('권한이 이미 허용·거절로 결정돼 있으면 뜨지 않는다', async () => {
    stubBrowser('granted')

    render(<BrowserPushPrompt eligible />)

    await waitFor(() => expect(getPushPublicKey).toHaveBeenCalled())
    expect(screen.queryByText(/이 브라우저에서 알림을 받을까요/)).not.toBeInTheDocument()
  })

  it('최근에 "나중에"를 눌렀으면 조건이 맞아도 뜨지 않는다', async () => {
    stubBrowser('default')
    localStorage.setItem('liveclass.browserPushPrompt.dismissedAt', String(Date.now()))

    render(<BrowserPushPrompt eligible />)

    await waitFor(() => expect(getPushPublicKey).toHaveBeenCalled())
    expect(screen.queryByText(/이 브라우저에서 알림을 받을까요/)).not.toBeInTheDocument()
  })

  it('다섯 조건이 모두 맞으면 사이트 안내가 뜬다', async () => {
    stubBrowser('default')

    render(<BrowserPushPrompt eligible />)

    expect(
      await screen.findByText('라이브 시작과 일정 변경을 놓치지 않도록 이 브라우저에서 알림을 받을까요?'),
    ).toBeInTheDocument()
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('개발 미리보기 쿼리에서는 VAPID 키와 대상 강의가 없어도 뜬다', async () => {
    stubBrowser('granted')
    getPushPublicKey.mockResolvedValue(null)
    window.history.replaceState({}, '', '/student/curriculums?previewBrowserPushPrompt=1')

    render(<BrowserPushPrompt eligible={false} />)

    expect(await screen.findByRole('status', { name: '브라우저 알림 안내' })).toBeInTheDocument()
    expect(getPushPublicKey).not.toHaveBeenCalled()
  })

  it('"브라우저 알림 켜기"를 눌러야만 권한을 묻는다', async () => {
    stubBrowser('default')
    const user = userEvent.setup()

    render(<BrowserPushPrompt eligible />)
    await user.click(await screen.findByRole('button', { name: '브라우저 알림 켜기' }))

    expect(Notification.requestPermission).toHaveBeenCalled()
    await waitFor(() => expect(registerPushSubscription).toHaveBeenCalled())
  })

  it('"나중에"를 누르면 배너가 사라지고 이 브라우저에 스누즈가 남는다', async () => {
    stubBrowser('default')
    const user = userEvent.setup()

    render(<BrowserPushPrompt eligible />)
    await user.click(await screen.findByRole('button', { name: '나중에' }))

    expect(screen.queryByText(/이 브라우저에서 알림을 받을까요/)).not.toBeInTheDocument()
    expect(wasBrowserPushPromptDismissedRecently()).toBe(true)
  })
})
