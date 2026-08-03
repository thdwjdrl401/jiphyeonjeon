import {
  ACTION_STATUS_BADGE,
  NOTIFICATION_CATEGORY_LABEL,
  formatNotificationTime,
  severityBadgeTone,
} from './notificationPresentation'
import type { NotificationItem } from './types'

interface NotificationRowProps {
  notification: NotificationItem
  onSelect: (notification: NotificationItem) => void
  busy: boolean
}

/**
 * 알림 한 줄. 드롭다운과 알림 페이지가 같은 컴포넌트를 쓴다 — 학생·강사도 마찬가지다. 역할에 따라
 * 달라지는 것은 <b>어떤 알림이 오는가</b>와 <b>어디로 이동하는가</b>뿐이고 줄의 생김새는 같다.
 *
 * <p>줄 전체가 버튼이다. 제목만 누를 수 있으면 설명·시각을 누른 사람은 아무 일도 일어나지 않는다고
 * 읽는다(헤더 프로필 칩에서 같은 이유로 영역 전체를 링크로 만들었다).
 */
export default function NotificationRow({ notification, onSelect, busy }: NotificationRowProps) {
  const unread = notification.readStatus === 'UNREAD'
  const actionBadge = ACTION_STATUS_BADGE[notification.actionStatus]
  const severityTone = severityBadgeTone(notification.severity)
  const time = formatNotificationTime(notification.createdAt)

  return (
    <li className={`notification-row${unread ? ' is-unread' : ''}`}>
      <button type="button" disabled={busy} onClick={() => onSelect(notification)}>
        {/* 읽지 않음 표시는 색만으로 구별되지 않게 스크린리더용 텍스트를 함께 둔다. */}
        <span aria-hidden="true" className="notification-row__dot" />
        {unread && <span className="visually-hidden">읽지 않은 알림</span>}

        <span className="notification-row__body">
          <span className="notification-row__meta">
            <span className={`notification-chip notification-chip--${severityTone ?? 'plain'}`}>
              {NOTIFICATION_CATEGORY_LABEL[notification.type]}
            </span>
            {actionBadge && (
              <span className={`status-pill status-pill--${actionBadge.tone}`}>{actionBadge.label}</span>
            )}
            <time className="notification-row__time" dateTime={notification.createdAt}>{time}</time>
          </span>
          <strong className="notification-row__title">{notification.title}</strong>
          <span className="notification-row__message">{notification.message}</span>
        </span>
      </button>
    </li>
  )
}
