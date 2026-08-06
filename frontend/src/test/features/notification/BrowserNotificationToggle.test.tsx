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
const isPushSubscriptionRegistered = vi.fn()
vi.mock('@/features/notification/notificationService', () => ({
  getPushPublicKey: () => getPushPublicKey(),
  registerPushSubscription: (s: unknown) => registerPushSubscription(s),
  unregisterPushSubscription: (e: string) => unregisterPushSubscription(e),
  isPushSubscriptionRegistered: (e: string) => isPushSubscriptionRegistered(e),
}))

import BrowserNotificationToggle from '@/features/notification/BrowserNotificationToggle'

/**
 * 전체 알림 페이지 헤더의 압축 토글.
 *
 * <p>지키려는 것은 셋이다 — <b>지원하지 않으면 아무것도 안 두는가</b>(켤 수 없는 스위치를
 * 보여 주지 않는다), <b>차단됐을 때는 스위치 대신 되물을 수 없다는 문구만 남는가</b>,
 * <b>스위치를 눌러 상태가 바뀌는가</b>.
 */
describe('BrowserNotificationToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerPushSubscription.mockResolvedValue(undefined)
    unregisterPushSubscription.mockResolvedValue(undefined)
    isPushSubscriptionRegistered.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubBrowser(existing: { endpoint: string; unsubscribe: () => unknown } | null, permission: 'default' | 'granted' | 'denied' = 'default') {
    const withKeys = existing ? { ...existing, getKey: () => new Uint8Array([1, 2, 3]).buffer } : null
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(withKeys),
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

  it('서버에 VAPID 키가 없으면 스위치는 그대로 두고 비활성화한다', async () => {
    stubBrowser(null)
    getPushPublicKey.mockResolvedValue(null)

    render(<BrowserNotificationToggle />)

    const toggle = await screen.findByRole('switch', { name: '이 브라우저에서 알림 받기' })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('구독이 없으면 꺼짐 상태의 스위치를 보여 준다', async () => {
    stubBrowser(null)
    getPushPublicKey.mockResolvedValue('BFakeKey')

    render(<BrowserNotificationToggle />)

    const toggle = await screen.findByRole('switch', { name: '이 브라우저에서 알림 받기' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('구독이 서버에 내 것으로 있으면 켜짐 상태의 스위치를 보여 준다', async () => {
    stubBrowser({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() }, 'granted')
    getPushPublicKey.mockResolvedValue('BFakeKey')
    isPushSubscriptionRegistered.mockResolvedValue(true)

    render(<BrowserNotificationToggle />)

    const toggle = await screen.findByRole('switch', { name: '이 브라우저에서 알림 받기' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  /**
   * 브라우저에 구독 객체가 남아 있어도 서버에 내 것이 아니면 푸시는 오지 않는다. 그때 "켜짐"으로
   * 그리면 다른 브라우저로 접속했는데 켜져 있다고 나온다 — 실제로 그렇게 보였다.
   */
  it('구독이 남아 있어도 서버에 내 것이 아니면 꺼짐으로 보여 준다', async () => {
    stubBrowser({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() }, 'granted')
    getPushPublicKey.mockResolvedValue('BFakeKey')
    isPushSubscriptionRegistered.mockResolvedValue(false)

    render(<BrowserNotificationToggle />)

    const toggle = await screen.findByRole('switch', { name: '이 브라우저에서 알림 받기' })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
  })

  it('차단돼 있으면 스위치 대신 문구만 보이고, 안내 팝오버는 닫혀 있다', async () => {
    stubBrowser(null, 'denied')
    getPushPublicKey.mockResolvedValue('BFakeKey')

    render(<BrowserNotificationToggle />)

    expect(await screen.findByText('브라우저 알림 차단됨')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('차단 문구를 누르면 해제 방법 팝오버가 열리고, 다시 누르거나 닫기로 닫힌다', async () => {
    stubBrowser(null, 'denied')
    getPushPublicKey.mockResolvedValue('BFakeKey')
    const user = userEvent.setup()

    render(<BrowserNotificationToggle />)
    await user.click(await screen.findByRole('button', { name: /브라우저 알림 차단됨/ }))

    const dialog = await screen.findByRole('dialog', { name: '차단 해제 방법' })
    expect(dialog).toHaveTextContent('알림')
    expect(dialog).toHaveTextContent('허용')

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('안내 팝오버가 열려 있을 때 바깥을 누르면 닫힌다', async () => {
    stubBrowser(null, 'denied')
    getPushPublicKey.mockResolvedValue('BFakeKey')
    const user = userEvent.setup()

    render(<BrowserNotificationToggle />)
    await user.click(await screen.findByRole('button', { name: /브라우저 알림 차단됨/ }))
    await screen.findByRole('dialog')

    await user.click(document.body)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('스위치를 누르면 서버에 구독을 등록하고 켜짐으로 바뀐다', async () => {
    stubBrowser(null)
    getPushPublicKey.mockResolvedValue('BFakeKey')
    const user = userEvent.setup()

    render(<BrowserNotificationToggle />)
    await user.click(await screen.findByRole('switch', { name: '이 브라우저에서 알림 받기' }))

    await waitFor(() => expect(registerPushSubscription).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '이 브라우저에서 알림 받기' })).toHaveAttribute('aria-checked', 'true'),
    )
  })

  it('켜져 있을 때 스위치를 누르면 서버 구독을 해제하고 꺼짐으로 바뀐다', async () => {
    stubBrowser({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() }, 'granted')
    getPushPublicKey.mockResolvedValue('BFakeKey')
    isPushSubscriptionRegistered.mockResolvedValue(true)
    const user = userEvent.setup()

    render(<BrowserNotificationToggle />)
    await user.click(await screen.findByRole('switch', { name: '이 브라우저에서 알림 받기' }))

    await waitFor(() => expect(unregisterPushSubscription).toHaveBeenCalledWith('https://push.example/abc'))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '이 브라우저에서 알림 받기' })).toHaveAttribute('aria-checked', 'false'),
    )
  })
})
