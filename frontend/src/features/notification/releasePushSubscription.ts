import { unregisterPushSubscription } from './notificationService'

/** 서비스워커 경로. 구독을 만들 때와 놓을 때가 같은 값을 봐야 한다. */
export const PUSH_WORKER_URL = '/push-worker.js'

/**
 * 로그아웃할 때 이 기기의 푸시를 끊는다.
 *
 * <p><b>서버 행만 지우고 브라우저 구독은 남긴다.</b> 서버 행이 없으면 푸시는 즉시 끊기므로 공용
 * PC에서 다음 사람에게 남의 알림이 뜨는 일이 없고, 구독을 남겨 두면 다시 로그인했을 때 권한을
 * 다시 묻지 않고 알아서 붙는다(설정 화면이 구독을 발견해 지금 로그인한 사람 앞으로 재등록한다).
 *
 * <p><b>세션 만료는 여기 걸리지 않는다.</b> 사용자가 로그아웃을 누르지 않고 그냥 떠나면 서버 행이
 * 남아 계속 푸시가 간다 — 명시적 로그아웃만 처리한다는 뜻이다. 만료까지 덮으려면 서버가 세션
 * 소멸을 감지해 지워야 하는데, 쿠키 세션에는 그 훅이 없다.
 */
export async function releasePushSubscription(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration(PUSH_WORKER_URL)
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return
    await unregisterPushSubscription(subscription.endpoint)
  } catch {
    // 여기서 실패해도 로그아웃은 진행한다 — 알림을 못 끊었다고 로그아웃이 막히면 안 된다.
  }
}
