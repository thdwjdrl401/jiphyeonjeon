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
const isPushSubscriptionRegistered = vi.fn()
vi.mock('@/features/notification/notificationService', () => ({
  getPushPublicKey: () => getPushPublicKey(),
  registerPushSubscription: (s: unknown) => registerPushSubscription(s),
  unregisterPushSubscription: (e: string) => unregisterPushSubscription(e),
  isPushSubscriptionRegistered: (e: string) => isPushSubscriptionRegistered(e),
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
    isPushSubscriptionRegistered.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function installBrowserPush(
    existing: { endpoint: string; unsubscribe: () => unknown } | null,
    permission: NotificationPermission = 'default',
  ) {
    // 재등록 경로가 키를 읽으므로 기존 구독에도 getKey가 있어야 한다.
    const withKeys = existing ? { ...existing, getKey: () => new Uint8Array([1, 2, 3]).buffer } : null
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example/abc',
      getKey: () => new Uint8Array([1, 2, 3]).buffer,
    })
    const registration = {
      // 이미 활성인 워커. 두 번째 이후 클릭이 이 상태다.
      active: {},
      pushManager: { getSubscription: vi.fn().mockResolvedValue(withKeys), subscribe },
    }
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    })
    vi.stubGlobal('Notification', {
      permission,
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
   * <b>브라우저에 구독 객체가 있다는 것만으로는 "켜짐"이 아니다.</b> 그 객체는 로그아웃해도 남고
   * (로그아웃은 서버 행만 지운다) 다른 계정으로 갈아타도 남는다. 실제로 푸시가 오는지는 서버에
   * 이 엔드포인트가 내 것으로 있는가가 정한다.
   */
  it('구독이 서버에 내 것으로 있으면 켜짐이다', async () => {
    installBrowserPush({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() }, 'granted')
    isPushSubscriptionRegistered.mockResolvedValue(true)

    const { result } = renderHook(() => usePushSubscription(true))

    await waitFor(() => expect(result.current.state).toBe('on'))
    expect(isPushSubscriptionRegistered).toHaveBeenCalledWith('https://push.example/abc')
  })

  /**
   * 이 브라우저에서 켠 적이 없거나 로그아웃으로 서버 행이 지워진 경우다. 구독 객체는 남아 있어도
   * 푸시는 오지 않으므로 <b>꺼짐</b>이어야 한다 — 다른 브라우저로 접속했는데 켜져 있다고 나오던 것.
   */
  it('구독이 남아 있어도 서버에 내 것이 아니면 꺼짐이고, 조용히 다시 등록하지 않는다', async () => {
    installBrowserPush({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() }, 'granted')
    isPushSubscriptionRegistered.mockResolvedValue(false)

    const { result } = renderHook(() => usePushSubscription(true))

    await waitFor(() => expect(result.current.state).toBe('off'))
    /*
     * 예전에는 여기서 지금 로그인한 사람 앞으로 옮겨 붙였다. 그러면 사용자가 켠 적 없는 브라우저가
     * 스스로 켜진다 — 켜는 것은 사용자의 행동이어야 한다.
     */
    expect(registerPushSubscription).not.toHaveBeenCalled()
  })

  /** 권한이 아직 'default'면 구독 자체가 있을 수 없다. 서버에 물어볼 것도 없다. */
  it('권한을 아직 허용하지 않았으면 서버에 묻지 않고 꺼짐이다', async () => {
    installBrowserPush({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn() }, 'default')

    const { result } = renderHook(() => usePushSubscription(true))

    await waitFor(() => expect(result.current.state).toBe('off'))
    expect(isPushSubscriptionRegistered).not.toHaveBeenCalled()
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
   * <b>첫 클릭이 씹히던 것.</b> {@code register()}는 설치가 끝나기 전에 resolve하는데, 그 등록으로
   * 바로 subscribe하면 브라우저가 "no active Service Worker"로 거절한다. 사용자에게는 권한을
   * 허용했는데도 스위치가 안 켜지고 한 번 더 눌러야 켜지는 것으로 보였다.
   */
  it('서비스워커가 설치 중이면 활성이 될 때까지 기다렸다가 구독한다', async () => {
    const { subscribe } = installBrowserPush(null)
    const listeners: Array<() => void> = []
    const installing = {
      state: 'installing',
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    }
    // 갓 등록된 상태 — active가 없고 installing만 있다.
    const fresh = {
      active: null,
      installing,
      pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe },
    }
    vi.mocked(navigator.serviceWorker.register).mockResolvedValue(fresh as never)

    const { result } = renderHook(() => usePushSubscription(true))
    await waitFor(() => expect(result.current.state).toBe('off'))

    await act(async () => {
      const enabling = result.current.enable()
      // 아직 활성이 아니다 — 여기서 구독을 시도하면 브라우저가 거절한다.
      await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
      expect(subscribe).not.toHaveBeenCalled()

      installing.state = 'activated'
      listeners.forEach((fn) => fn())
      await enabling
    })

    expect(subscribe).toHaveBeenCalled()
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
    // 켜져 있는 상태 = 권한 허용 + 브라우저 구독 + 서버에 내 것으로 등록됨. 셋이 다 있어야 한다.
    installBrowserPush({ endpoint: 'https://push.example/abc', unsubscribe }, 'granted')
    isPushSubscriptionRegistered.mockResolvedValue(true)
    const { result } = renderHook(() => usePushSubscription(true))
    await waitFor(() => expect(result.current.state).toBe('on'))

    await act(async () => {
      await result.current.disable()
    })

    expect(order).toEqual(['server', 'browser'])
    expect(result.current.state).toBe('off')
  })
})
