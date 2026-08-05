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
 * <p><b>폴링을 대체한다.</b> 예전에는 60초 폴링을 함께 돌렸다 — 연결이 끊긴 동안 온 알림은 신호가
 * 오지 않으니 폴링이 그 공백을 메운다는 이유였다. 공백을 메우는 데 필요한 것은 <b>다시 붙는 순간의
 * 한 번</b>이지 영구 폴링이 아니다. 브로커(SimpleBroker)는 재전송을 하지 않으므로 그 시점이 유일한
 * 복구 지점이고, 그래서 여기서 그것만 한다.
 *
 * <p>폴링을 지운 진짜 이유는 따로 있다. 세션 만료는 <b>사용자의 부재</b>를 재는 것인데, 60초마다
 * 요청이 나가면 Spring Session이 매번 lastAccessedTime을 갱신해 30분 창을 서른 번 되돌린다. 탭을
 * 화면에 띄워 둔 채 자리를 비워도 세션이 영영 살아 있었다 — 유휴 만료가 무력화돼 있었다.
 */
export function useNotificationRealtime(enabled: boolean) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    const sync = () => queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all })
    // 신호가 오면 다시 읽고, 붙는 순간에도 다시 읽는다(끊긴 동안의 공백).
    const unsubscribe = subscribeNotifications(sync, sync)
    return unsubscribe
  }, [enabled, queryClient])
}
