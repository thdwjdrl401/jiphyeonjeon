import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type { NotificationService } from './notificationService.interface'
import type {
  NotificationItem,
  NotificationListQuery,
  NotificationListResponse,
  NotificationSummary,
} from './types'

/**
 * 알림 HTTP 어댑터.
 *
 * <p>서버 응답의 필드 이름이 화면 타입과 그대로 같아서 <b>변환하지 않는다</b>. 이름을 맞춰 둔 것은
 * 우연이 아니라 계약(`docs/CONTRACT.md §2-4`)을 그렇게 정한 결과이고, 중간에 매핑 층을 두면 서버가
 * 필드를 하나 바꿨을 때 타입 검사가 아니라 런타임에서 티가 난다.
 *
 * <p><b>`resolveTarget`만 아직 501이다.</b> 대상 재판정은 다른 모듈 넷(커리큘럼·강의·라이브·수강)을
 * 읽어야 하는데, 알림을 만드는 발행 지점이 아직 없어서 <b>누를 알림 자체가 없다</b>. 없는 경로를
 * 호출해 404를 받으면 화면이 그것을 서버 장애와 구별할 수 없으므로, 성공을 흉내 내는 대신
 * 501 `API_NOT_IMPLEMENTED`를 그대로 둔다.
 */
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
  async resolveTarget(notificationId: string) {
    return notImplemented(`GET /me/notifications/${notificationId}/target`)
  },
} satisfies NotificationService
