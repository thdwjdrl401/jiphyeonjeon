import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { subscribeNotifications } from './notificationService'
import { notificationQueryKeys } from './useNotificationQueries'

/**
 * 새 알림 신호를 받아 알림함을 즉시 갱신한다.
 *
 * <p>신호에는 <b>내용이 없다</b>. 받으면 캐시를 무효화하고 이미 화면에 걸린 쿼리만 다시 읽는다 —
 * 알림 한 건의 모양을 REST 응답과 WS 페이로드 두 곳에 두면 한쪽만 고치는 어긋남이 자란다.
 *
 * <p><b>폴링을 대체하지 않는다.</b> 60초 주기는 그대로 둔다 — 연결이 끊긴 동안 온 알림은 신호가
 * 오지 않으므로, 폴링이 없으면 다시 연결될 때까지 배지가 멈춘다. 실시간은 그 사이를 좁힐 뿐이다.
 */
export function useNotificationRealtime(enabled: boolean) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    const unsubscribe = subscribeNotifications(() => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all })
    })
    return unsubscribe
  }, [enabled, queryClient])
}
