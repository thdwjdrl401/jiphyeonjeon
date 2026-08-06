import { Client } from '@stomp/stompjs'
import { apiClient } from '@/shared/api/client'
import type { NotificationService, SavePreferenceInput } from './notificationService.interface'
import type {
  NotificationItem,
  NotificationListQuery,
  NotificationListResponse,
  NotificationLeadTimes,
  NotificationPreference,
  NotificationSignal,
  PushSubscriptionInput,
  NotificationSummary,
  NotificationTargetResolution,
} from './types'

/**
 * 알림 HTTP 어댑터.
 *
 * <p>서버 응답의 필드 이름이 화면 타입과 그대로 같아서 <b>변환하지 않는다</b>. 이름을 맞춰 둔 것은
 * 우연이 아니라 계약(`docs/CONTRACT.md §2-4`)을 그렇게 정한 결과이고, 중간에 매핑 층을 두면 서버가
 * 필드를 하나 바꿨을 때 타입 검사가 아니라 런타임에서 티가 난다.
 *
 * <p>`resolveTarget`의 `GONE`은 <b>오류가 아니라 정상 200</b>이다. 404로 받으면 화면이 "삭제된
 * 강의입니다"와 "잠시 후 다시 시도해 주세요"를 구별할 수 없어서, 서버가 이유를 본문에 담아 준다.
 */
function brokerUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/ws`
}

export const httpNotificationService = {
  async getSummary() {
    const { data } = await apiClient.get<NotificationSummary>('/me/notifications/summary')
    return data
  },
  async getNotifications(query?: NotificationListQuery) {
    const { data } = await apiClient.get<NotificationListResponse>('/me/notifications', {
      /*
       * undefined인 키는 axios가 아예 빼고 보낸다. 그래서 "가리지 않음"을 빈 문자열이 아니라
       * 파라미터 부재로 표현할 수 있고, 서버도 그것을 null로 받는다.
       */
      params: {
        scope: query?.scope,
        readState: query?.readState,
        page: query?.page,
        size: query?.size,
      },
    })
    return data
  },
  async markAsRead(notificationId: string) {
    const { data } = await apiClient.post<NotificationItem>(
      `/me/notifications/${notificationId}/read`,
    )
    return data
  },
  async markAllAsRead() {
    const { data } = await apiClient.post<NotificationSummary>('/me/notifications/read-all')
    return data
  },
  async getNotificationLeadTimes() {
    const { data } = await apiClient.get<NotificationLeadTimes>(
      '/me/notification-preferences/lead-times',
    )
    return data
  },
  async getNotificationPreference(curriculumId: string, lessonId?: string) {
    const { data } = await apiClient.get<NotificationPreference>('/me/notification-preferences', {
      // lessonId가 없으면 키를 빼고 보낸다 — 커리큘럼 전체 설정을 묻는다는 뜻이다.
      params: { curriculumId, lessonId },
    })
    return data
  },
  async saveNotificationPreference(input: SavePreferenceInput) {
    await apiClient.put('/me/notification-preferences', input)
  },
  async getPushPublicKey() {
    const { data } = await apiClient.get<{ publicKey: string | null }>(
      '/me/push-subscriptions/public-key',
    )
    return data.publicKey
  },
  async registerPushSubscription(subscription: PushSubscriptionInput) {
    await apiClient.post('/me/push-subscriptions', subscription)
  },
  async unregisterPushSubscription(endpoint: string) {
    // 본문이 있는 DELETE다 — 엔드포인트는 URL에 담기엔 길고, 경로에 넣으면 인코딩이 지저분해진다.
    await apiClient.delete('/me/push-subscriptions', { data: { endpoint } })
  },
  async isPushSubscriptionRegistered(endpoint: string) {
    // 조회지만 POST다 — 엔드포인트를 쿼리스트링에 실으면 기기 식별자가 접근 로그·리퍼러에 남는다.
    const { data } = await apiClient.post<{ registered: boolean }>(
      '/me/push-subscriptions/status',
      { endpoint },
    )
    return data.registered
  },
  subscribeNotifications(onSignal: (signal: NotificationSignal) => void, onConnected?: () => void) {
    let active = true
    const client = new Client({
      brokerURL: brokerUrl(),
      connectionTimeout: 10_000,
      heartbeatIncoming: 10_000,
      heartbeatOutgoing: 10_000,
      reconnectDelay: 3_000,
    })

    client.onConnect = () => {
      if (!active) return
      /*
       * `/user` 접두사는 서버가 이 목적지를 **내 세션의 주체로** 해석하게 한다. 그래서 남의
       * 알림을 구독할 방법이 없고, 세션 id를 URL에 담을 일도 없다.
       */
      client.subscribe('/user/queue/notifications', (frame) => {
        try {
          onSignal(JSON.parse(frame.body) as NotificationSignal)
        } catch {
          // 프레임 하나가 깨져도 구독은 살려 둔다 — 다음 알림은 받아야 한다.
        }
      })
      /*
       * 구독을 건 **뒤에** 알린다. 이 순서라야 "다시 읽는 동안 온 알림"이 구독으로 잡힌다 —
       * 먼저 알리면 다시 읽기와 구독 사이에 도착한 알림이 어느 쪽에도 안 걸린다.
       *
       * 최초 연결에도 불린다. 그 한 번은 화면이 이미 목록을 읽은 직후라 대개 헛일이지만,
       * "붙었으면 맞춘다"는 규칙이 하나뿐이어야 재연결 경로가 따로 놀지 않는다.
       */
      onConnected?.()
    }

    client.activate()

    return () => {
      active = false
      void client.deactivate()
    }
  },
  async resolveTarget(notificationId: string) {
    const { data } = await apiClient.get<NotificationTargetResolution>(
      `/me/notifications/${notificationId}/target`,
    )
    return data
  },
} satisfies NotificationService
