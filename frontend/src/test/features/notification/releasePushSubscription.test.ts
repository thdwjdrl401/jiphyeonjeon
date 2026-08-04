import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const unregisterPushSubscription = vi.fn()
vi.mock('@/features/notification/notificationService', () => ({
  unregisterPushSubscription: (e: string) => unregisterPushSubscription(e),
}))

import { releasePushSubscription } from '@/features/notification/releasePushSubscription'

/**
 * 로그아웃할 때 이 기기의 푸시를 끊는다.
 *
 * <p>지키려는 것은 셋이다 — <b>서버 행을 지우는가</b>, <b>브라우저 구독은 남기는가</b>(다시
 * 로그인할 때 권한을 다시 묻지 않기 위해), <b>실패해도 로그아웃을 막지 않는가</b>.
 */
describe('로그아웃 시 푸시 구독 정리', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unregisterPushSubscription.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function installBrowser(subscription: { endpoint: string; unsubscribe: () => unknown } | null) {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
        }),
      },
    })
    vi.stubGlobal('PushManager', function PushManager() {})
  }

  it('서버에서 이 기기의 구독을 지운다', async () => {
    const unsubscribe = vi.fn()
    installBrowser({ endpoint: 'https://push.example/abc', unsubscribe })

    await releasePushSubscription()

    expect(unregisterPushSubscription).toHaveBeenCalledWith('https://push.example/abc')
    // 브라우저 구독은 남긴다 — 다시 로그인하면 권한을 다시 묻지 않고 알아서 붙는다.
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('구독이 없으면 아무것도 하지 않는다', async () => {
    installBrowser(null)

    await releasePushSubscription()

    expect(unregisterPushSubscription).not.toHaveBeenCalled()
  })

  /** 알림을 못 끊었다고 로그아웃이 막히면 안 된다. */
  it('서버 호출이 실패해도 예외를 올리지 않는다', async () => {
    installBrowser({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() })
    unregisterPushSubscription.mockRejectedValue(new Error('network'))

    await expect(releasePushSubscription()).resolves.toBeUndefined()
  })

  it('푸시를 지원하지 않는 브라우저에서는 조용히 끝난다', async () => {
    vi.stubGlobal('navigator', {})

    await expect(releasePushSubscription()).resolves.toBeUndefined()
    expect(unregisterPushSubscription).not.toHaveBeenCalled()
  })
})
