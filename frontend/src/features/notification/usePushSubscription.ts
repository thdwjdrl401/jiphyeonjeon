import { useCallback, useEffect, useState } from 'react'
import {
  getPushPublicKey,
  registerPushSubscription,
  unregisterPushSubscription,
} from './notificationService'

/**
 * Web Push 구독 상태와 켜기·끄기.
 *
 * <p>탭이 열려 있을 때는 STOMP가 알림함을 갱신하고, 이건 <b>탭을 닫았을 때</b>를 맡는다.
 *
 * <p><b>권한을 먼저 묻지 않는다.</b> 브라우저 권한 프롬프트는 사용자가 명시적으로 켤 때만 띄운다 —
 * 방문하자마자 뜨는 알림 권한 요청은 대부분 거절되고, 한 번 거절되면 그 브라우저에서는 다시 물을
 * 수 없다(설정에서 직접 되돌려야 한다).
 */
export type PushState =
  /** 이 브라우저가 Web Push를 지원하지 않거나 서버에 키가 없다. UI를 숨긴다. */
  | 'unavailable'
  /** 켤 수 있다. */
  | 'off'
  | 'on'
  /** 사용자가 거절했다. 다시 물을 수 없으므로 안내만 한다. */
  | 'denied'
  | 'working'

interface PushSubscriptionControls {
  state: PushState
  enable: () => Promise<void>
  disable: () => Promise<void>
}

const WORKER_URL = '/push-worker.js'

export function usePushSubscription(enabled: boolean): PushSubscriptionControls {
  const [state, setState] = useState<PushState>('unavailable')

  useEffect(() => {
    if (!enabled || !isSupported()) return
    let active = true

    void (async () => {
      const publicKey = await getPushPublicKey().catch(() => null)
      if (!active) return
      if (!publicKey) {
        // 서버에 VAPID 키가 없다 — 로컬·미설정 환경이다. 켤 수 없는 스위치를 보여 주지 않는다.
        setState('unavailable')
        return
      }
      if (Notification.permission === 'denied') {
        setState('denied')
        return
      }
      const registration = await navigator.serviceWorker.getRegistration(WORKER_URL)
      const existing = await registration?.pushManager.getSubscription()
      if (!active) return
      setState(existing ? 'on' : 'off')
    })()

    return () => {
      active = false
    }
  }, [enabled])

  const enable = useCallback(async () => {
    if (!isSupported()) return
    setState('working')
    try {
      const publicKey = await getPushPublicKey()
      if (!publicKey) {
        setState('unavailable')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const registration = await navigator.serviceWorker.register(WORKER_URL)
      const subscription = await registration.pushManager.subscribe({
        // 표준이 요구한다. false면 브라우저가 구독을 거부한다 — 사용자에게 보이지 않는 푸시를 막는 규칙이다.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await registerPushSubscription(readKeys(subscription))
      setState('on')
    } catch {
      setState('off')
    }
  }, [])

  const disable = useCallback(async () => {
    if (!isSupported()) return
    setState('working')
    try {
      const registration = await navigator.serviceWorker.getRegistration(WORKER_URL)
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        /*
         * 서버에서 먼저 지운다. 브라우저 구독만 지우고 서버 행이 남으면 그 기기로 계속 보내다가
         * 404를 받고서야 정리되는데, 그동안 발송이 헛돈다.
         */
        await unregisterPushSubscription(subscription.endpoint).catch(() => undefined)
        await subscription.unsubscribe()
      }
      setState('off')
    } catch {
      setState('on')
    }
  }, [])

  return { state, enable, disable }
}

function isSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** 구독의 키를 서버가 쓰는 base64url 문자열로 꺼낸다. */
function readKeys(subscription: PushSubscription) {
  return {
    endpoint: subscription.endpoint,
    p256dh: encodeKey(subscription.getKey('p256dh')),
    auth: encodeKey(subscription.getKey('auth')),
  }
}

function encodeKey(key: ArrayBuffer | null) {
  if (!key) return ''
  const bytes = new Uint8Array(key)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * VAPID 공개키는 base64url 문자열인데 `pushManager.subscribe`는 바이트 배열을 요구한다.
 * 표준이 그렇게 정해져 있어서 이 변환이 어디에나 있다.
 */
function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}
