import NotificationRow from './NotificationRow'
import type { NotificationItem } from './types'

interface NotificationListProps {
  items: NotificationItem[]
  onSelect: (notification: NotificationItem) => void
  /** 지금 이동 처리 중인 알림. 같은 줄을 두 번 눌러 두 번 이동하지 않게 잠근다. */
  activatingId: string | null
  emptyMessage: string
  /** 목록의 스크린리더 이름. 드롭다운과 페이지가 같은 화면에 있을 수 있어 서로 구별한다. */
  label: string
}

/**
 * 알림 목록. 드롭다운(최근 몇 건)과 알림 페이지(전체·필터)가 같은 컴포넌트를 공유한다 — 목록을 두 벌
 * 만들면 읽음 강조·확인 필요 배지 같은 규칙이 한쪽에만 반영되는 일이 생긴다.
 */
export default function NotificationList({
  items,
  onSelect,
  activatingId,
  emptyMessage,
  label,
}: NotificationListProps) {
  if (items.length === 0) {
    return <p className="notification-empty">{emptyMessage}</p>
  }

  return (
    <ul className="notification-list" aria-label={label}>
      {items.map((notification) => (
        <NotificationRow
          key={notification.notificationId}
          notification={notification}
          onSelect={onSelect}
          busy={activatingId === notification.notificationId}
        />
      ))}
    </ul>
  )
}
