import { notImplemented } from '@/shared/api/notImplemented'
import type { NotificationService } from './notificationService.interface'

/**
 * 알림 HTTP 어댑터.
 *
 * <p><b>서버에 알림 도메인이 아직 없다.</b> `backend/src/main/java/com/liveclass` 아래에 알림 패키지·
 * 테이블·엔드포인트가 없고, 알림을 만들어야 할 사건(수강 판정·강의 게시·Egress 완료)에도 발행 지점이
 * 없다. 그래서 여기서는 <b>성공을 흉내 내지 않는다</b> — 없는 경로를 호출해 404를 받으면 화면이 그것을
 * 서버 장애와 구별할 수 없고, 임의 응답을 만들어 두면 "됐다"고 착각한 채 배포된다.
 *
 * <p>`notImplemented`는 501 `API_NOT_IMPLEMENTED`를 던진다. 헤더 종·알림 페이지는 이 code를 보고
 * "준비 중"으로 안내하고 다른 화면을 막지 않는다.
 *
 * <p>필요한 서버 작업은 `docs/CONTRACT.md §2-4`에 Method·URL·DTO·상태코드·권한 규칙으로 적어 두었다.
 * 서버가 생기면 아래 각 줄을 `apiClient` 호출과 응답 매핑으로 바꾸면 되고, Interface·화면·Mock은
 * 그대로다.
 */
export const httpNotificationService = {
  async getSummary() {
    return notImplemented('GET /me/notifications/summary')
  },
  async getNotifications() {
    return notImplemented('GET /me/notifications')
  },
  async markAsRead(notificationId) {
    return notImplemented(`POST /me/notifications/${notificationId}/read`)
  },
  async markAllAsRead() {
    return notImplemented('POST /me/notifications/read-all')
  },
  async resolveTarget(notificationId) {
    return notImplemented(`GET /me/notifications/${notificationId}/target`)
  },
} satisfies NotificationService
