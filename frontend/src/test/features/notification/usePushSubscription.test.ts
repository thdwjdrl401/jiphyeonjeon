import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

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

import { usePushSubscription } from '@/features/notification/usePushSubscription'

/**
 * Web Push 구독 흐름.
 *
 * <p>지키려는 것은 셋이다 — <b>서버에 키가 없으면 스위치를 숨기는가</b>, <b>권한을 켤 때만 묻는가</b>,
 * <b>끌 때 서버를 먼저 지우는가</b>.
 *
 * <p>마지막이 중요하다. 브라우저 구독만 지우고 서버 행이 남으면 그 기기로 계속 보내다가 404를
 * 받고서야 정리되는데, 그동안 발송이 헛돈다.
 */
describe('푸시 구독', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /*
     * 인터페이스가 전부 Promise를 돌려준다. 목이 undefined를 주면 훅의 .catch에서 터지는데,
     * 그건 목이 계약을 안 지킨 것이지 훅의 문제가 아니다.
     */
    getPushPublicKey.mockResolvedValue('BFakeKey')
    registerPushSubscription.mockResolvedValue(undefined)
    unregisterPushSubscription.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function installBrowserPush(existing: { endpoint: string; unsubscribe: () => unknown } | null) {
    // 재등록 경로가 키를 읽으므로 기존 구독에도 getKey가 있어야 한다.
    const withKeys = existing ? { ...existing, getKey: () => new Uint8Array([1, 2, 3]).buffer } : null
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example/abc',
      getKey: () => new Uint8Array([1, 2, 3]).buffer,
    })
    const registration = {
      pushManager: { getSubscription: vi.fn().mockResolvedValue(withKeys), subscribe },
    }
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
      },
    })
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    vi.stubGlobal('PushManager', function PushManager() {})
    return { subscribe }
  }

  /** 켤 수 없는 스위치를 보여 주지 않는다. */
  it('서버에 VAPID 키가 없으면 쓸 수 없는 상태로 둔다', async () => {
    installBrowserPush(null)
    getPushPublicKey.mockResolvedValue(null)

    const { result } = renderHook(() => usePushSubscription(true))

    await waitFor(() => expect(result.current.state).toBe('unavailable'))
  })

  it('키가 있고 아직 구독이 없으면 켤 수 있다', async () => {
    installBrowserPush(null)
    getPushPublicKey.mockResolvedValue('BFakeKey')

    const { result } = renderHook(() => usePushSubscription(true))

    await waitFor(() => expect(result.current.state).toBe('off'))
    // 화면을 여는 것만으로 권한을 묻지 않는다 — 한 번 거절되면 다시 물을 수 없다.
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })

  /**
   * 같은 브라우저에서 계정을 바꾸면 브라우저 구독은 그대로인데 서버 행은 이전 사용자 것이다.
   * 그대로 두면 화면은 "켜짐"인데 푸시는 그 사람에게 간다 — 운영에서 실제로 그랬다.
   */
  it('브라우저 구독이 이미 있으면 지금 로그인한 사람 앞으로 다시 등록한다', async () => {
    installBrowserPush({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() })
    getPushPublicKey.mockResolvedValue('BFakeKey')
    registerPushSubscription.mockResolvedValue(undefined)

    const { result } = renderHook(() => usePushSubscription(true))

    await waitFor(() => expect(result.current.state).toBe('on'))
    expect(registerPushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/abc' }),
    )
  })

  it('켜면 권한을 묻고 서버에 구독을 등록한다', async () => {
    installBrowserPush(null)
    getPushPublicKey.mockResolvedValue('BFakeKey')
    const { result } = renderHook(() => usePushSubscription(true))
    await waitFor(() => expect(result.current.state).toBe('off'))

    await act(async () => {
      await result.current.enable()
    })

    expect(Notification.requestPermission).toHaveBeenCalled()
    expect(registerPushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/abc' }),
    )
    expect(result.current.state).toBe('on')
  })

  /**
   * 서버를 먼저 지운다. 브라우저 구독만 지우고 서버 행이 남으면 그 기기로 계속 보내다가 404를
   * 받고서야 정리되는데, 그동안 발송이 헛돈다.
   */
  it('끄면 서버에서 먼저 지우고 브라우저 구독을 해제한다', async () => {
    const order: string[] = []
    const unsubscribe = vi.fn().mockImplementation(async () => {
      order.push('browser')
      return true
    })
    unregisterPushSubscription.mockImplementation(async () => {
      order.push('server')
    })
    installBrowserPush({ endpoint: 'https://push.example/abc', unsubscribe })
    getPushPublicKey.mockResolvedValue('BFakeKey')
    const { result } = renderHook(() => usePushSubscription(true))
    await waitFor(() => expect(result.current.state).toBe('on'))

    await act(async () => {
      await result.current.disable()
    })

    expect(order).toEqual(['server', 'browser'])
    expect(result.current.state).toBe('off')
  })
})
