import type {
  NotificationItem,
  NotificationListQuery,
  NotificationListResponse,
  NotificationSummary,
  NotificationSignal,
  NotificationTargetResolution,
} from './types'

export interface NotificationService {
  /** 헤더 배지용 개수만. 목록을 받지 않으므로 주기적으로 불러도 부담이 적다. */
  getSummary: () => Promise<NotificationSummary>
  /**
   * 알림 목록. 페이지네이션이 <b>필수</b>다 — 전체를 한 번에 받으면 오래 쓴 계정에서 응답이
   * 무한히 자란다. 드롭다운은 `size`를 작게(5) 주고, 알림 페이지는 더 크게 준다.
   *
   * <p>필터는 `scope`(업무 처리 축)와 `readState`(읽음 축) <b>두 개</b>이며 AND로 겹친다.
   * 하나의 enum으로 묶지 않는 이유는 `NotificationScope` 주석에 있다.
   */
  getNotifications: (query?: NotificationListQuery) => Promise<NotificationListResponse>
  /** 개별 읽음. 이미 READ면 그대로 돌려준다(멱등). 처리 상태는 건드리지 않는다. */
  markAsRead: (notificationId: string) => Promise<NotificationItem>
  markAllAsRead: () => Promise<NotificationSummary>
  /**
   * 클릭 시점의 대상 상태 재판정. 이동 경로는 프론트가 계산하지만, 대상이 아직 존재하고
   * 열람 권한이 있는지는 서버만 안다(요구사항 §10·§11).
   */
  resolveTarget: (notificationId: string) => Promise<NotificationTargetResolution>
  /**
   * 새 알림이 도착했다는 <b>신호</b>를 구독한다. 내용은 오지 않는다 — 받으면 목록·개수를 다시
   * 읽는다. 서버가 그렇게 보내는 이유는 넓은 팬아웃이 집합 삽입이라 행 데이터가 앱에 없기
   * 때문이고, 알림 모양이 REST와 WS 두 곳에 생기는 것도 피한다.
   *
   * @returns 구독 해제 함수
   */
  subscribeNotifications: (onSignal: (signal: NotificationSignal) => void) => () => void
}
