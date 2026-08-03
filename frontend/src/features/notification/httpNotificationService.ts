import { apiClient } from '@/shared/api/client'
import type { NotificationService } from './notificationService.interface'
import type {
  NotificationItem,
  NotificationListQuery,
  NotificationListResponse,
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
    const { data } = await apiClient.get<NotificationTargetResolution>(
      `/me/notifications/${notificationId}/target`,
    )
    return data
  },
} satisfies NotificationService
