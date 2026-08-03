import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getNotificationsPath } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { isNotImplemented } from '@/shared/api/notImplemented'
import NotificationList from './NotificationList'
import { useNotificationActivation } from './useNotificationActivation'
import { useMarkAllNotificationsReadMutation } from './useNotificationMutations'
import { useNotificationSummaryQuery, useRecentNotificationsQuery } from './useNotificationQueries'

/** 드롭다운은 "최근"만 보여 준다. 전체 이력·필터는 알림 페이지가 맡는다. */
const RECENT_SIZE = 5

/** 세 자리가 되면 배지가 메뉴 폭을 밀어낸다. 정확한 수보다 "많다"가 중요한 자리다. */
const BADGE_LIMIT = 99

function formatBadge(count: number) {
  return count > BADGE_LIMIT ? `${BADGE_LIMIT}+` : String(count)
}

/**
 * 헤더 알림 종.
 *
 * <p>학생·강사가 같은 컴포넌트를 쓴다. 역할에 따라 달라지는 것은 서버가 주는 <b>알림 내용</b>과
 * `전체 알림 보기`의 목적지뿐이다.
 *
 * <p>목록은 종을 <b>열 때</b> 불러온다. 로그인한 모든 화면이 최근 알림까지 미리 받으면 쓰지도 않는
 * 목록을 매번 들고 있게 된다 — 개수만 폴링하고 목록은 필요할 때 받는다.
 */
export default function NotificationBell() {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const summaryQuery = useNotificationSummaryQuery(Boolean(user))
  const recentQuery = useRecentNotificationsQuery(RECENT_SIZE, Boolean(user) && isOpen)
  const markAllAsRead = useMarkAllNotificationsReadMutation()
  const { activate, activatingId } = useNotificationActivation()

  /*
    바깥을 누르거나 Escape를 누르면 닫는다. 열려 있는 동안에만 리스너를 붙인다 — 헤더는 모든 화면에
    떠 있으므로 닫힌 상태에서도 문서 전역 리스너를 유지하면 클릭마다 불필요한 일을 한다.
  */
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!user) return null

  const unreadCount = summaryQuery.data?.unreadCount ?? 0
  const notificationsPath = getNotificationsPath(user.role)
  const items = recentQuery.data?.items ?? []
  const listUnavailable = isNotImplemented(recentQuery.error)

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        className={`notification-bell__button${unreadCount > 0 ? ' has-unread' : ''}`}
        type="button"
        aria-expanded={isOpen}
        aria-controls="notification-dropdown"
        aria-label={unreadCount > 0 ? `알림 (읽지 않음 ${unreadCount}건)` : '알림'}
        onClick={() => setIsOpen((current) => !current)}
      >
        {/* 종 모양은 아이콘 폰트 없이 그린다(프로젝트는 UI 프레임워크를 쓰지 않는다). */}
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M12 3a5.5 5.5 0 0 0-5.5 5.5v3.2c0 .5-.18.98-.5 1.36L4.6 14.7a1 1 0 0 0 .77 1.64h13.26a1 1 0 0 0 .77-1.64l-1.4-1.64a2.1 2.1 0 0 1-.5-1.36V8.5A5.5 5.5 0 0 0 12 3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9.8 18.4a2.3 2.3 0 0 0 4.4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 && (
          <span className="notification-bell__badge" aria-hidden="true">{formatBadge(unreadCount)}</span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown" id="notification-dropdown" role="dialog" aria-label="알림">
          <header className="notification-dropdown__header">
            <strong>알림</strong>
            <button
              className="text-button"
              type="button"
              disabled={markAllAsRead.isPending || unreadCount === 0}
              onClick={() => markAllAsRead.mutate()}
            >
              모두 읽음
            </button>
          </header>

          {recentQuery.isPending ? (
            <p className="notification-empty">알림을 불러오는 중입니다.</p>
          ) : listUnavailable ? (
            <p className="notification-empty">알림 기능은 아직 준비 중입니다.</p>
          ) : recentQuery.isError ? (
            <p className="notification-empty">알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
          ) : (
            <NotificationList
              items={items}
              onSelect={(notification) => {
                setIsOpen(false)
                void activate(notification)
              }}
              activatingId={activatingId}
              emptyMessage="새로운 알림이 없습니다."
              label="최근 알림"
            />
          )}

          <footer className="notification-dropdown__footer">
            <Link to={notificationsPath} onClick={() => setIsOpen(false)}>전체 알림 보기</Link>
          </footer>
        </div>
      )}
    </div>
  )
}
