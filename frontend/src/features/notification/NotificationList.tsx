import type { ReactNode, UIEvent } from 'react'
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
  /**
   * 목록 <b>자체가 스크롤 컨테이너</b>일 때, 바닥에 가까워지면 부른다(드롭다운의 무한 스크롤).
   *
   * <p>넘기지 않으면 예전 그대로다 — 알림 페이지는 문서 전체가 스크롤되고 `더 보기` 버튼이 있어
   * 여기서 잡을 스크롤이 없다.
   */
  onReachEnd?: () => void
  /** 목록 아래에 붙일 것(불러오는 중 표시 등). 스크롤 컨테이너 안에 있어야 따라 올라온다. */
  footer?: ReactNode
}

/**
 * 바닥에서 이만큼 남았을 때 다음 장을 당긴다. 한 줄(약 72px)보다 넉넉해야 <b>닿기 전에</b>
 * 도착해서 스크롤이 끊기지 않는다.
 */
const REACH_END_SLACK_PX = 160

/**
 * 알림 목록. 드롭다운(최근 몇 건)과 알림 페이지(전체·필터)가 같은 컴포넌트를 공유한다 — 목록을 두 벌
 * 만들면 읽음 강조·처리 대기 배지 같은 규칙이 한쪽에만 반영되는 일이 생긴다.
 */
export default function NotificationList({
  items,
  onSelect,
  activatingId,
  emptyMessage,
  label,
  onReachEnd,
  footer,
}: NotificationListProps) {
  if (items.length === 0) {
    return <p className="notification-empty">{emptyMessage}</p>
  }

  const handleScroll = (event: UIEvent<HTMLUListElement>) => {
    if (!onReachEnd) return
    const el = event.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= REACH_END_SLACK_PX) onReachEnd()
  }

  return (
    <ul className="notification-list" aria-label={label} onScroll={handleScroll}>
      {items.map((notification) => (
        <NotificationRow
          key={notification.notificationId}
          notification={notification}
          onSelect={onSelect}
          busy={activatingId === notification.notificationId}
        />
      ))}
      {footer}
    </ul>
  )
}
