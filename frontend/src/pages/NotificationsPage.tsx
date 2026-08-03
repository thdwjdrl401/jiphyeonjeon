import { useState } from 'react'
import NotificationList from '@/features/notification/NotificationList'
import type { NotificationFilter } from '@/features/notification/types'
import { useNotificationActivation } from '@/features/notification/useNotificationActivation'
import { useMarkAllNotificationsReadMutation } from '@/features/notification/useNotificationMutations'
import { useNotificationListQuery } from '@/features/notification/useNotificationQueries'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import { InlineNotice, MetricCard, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

const FILTER_TABS: ReadonlyArray<TabItem<NotificationFilter>> = [
  { id: 'ALL', label: '전체' },
  { id: 'UNREAD', label: '읽지 않음' },
  { id: 'ACTION_REQUIRED', label: '처리 필요' },
]

const FILTER_TAB_PREFIX = 'notification-filter'

/** 한 번에 받는 개수. 알림은 계속 쌓이므로 전체를 한 번에 불러오지 않는다. */
const PAGE_SIZE = 8

const emptyMessage: Record<NotificationFilter, string> = {
  ALL: '아직 받은 알림이 없습니다.',
  UNREAD: '읽지 않은 알림이 없습니다.',
  ACTION_REQUIRED: '처리해야 할 알림이 없습니다.',
}

/**
 * 알림 전체 이력.
 *
 * <p>학생·강사가 같은 화면·같은 목록 컴포넌트를 쓴다. 보이는 알림은 서버가 수신자로 걸러 주므로
 * 이 화면에 역할 조건문이 없다 — 역할별로 화면을 나누면 필터·읽음·페이지네이션을 두 벌 유지해야 한다.
 */
export default function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>('ALL')
  const listQuery = useNotificationListQuery(filter, PAGE_SIZE, true)
  const markAllAsRead = useMarkAllNotificationsReadMutation()
  const { activate, activatingId } = useNotificationActivation()
  usePageTitle('알림')

  const pages = listQuery.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  // 개수는 필터와 무관한 전체 기준이라 어느 페이지에서 읽어도 같다.
  const counts = pages[0]

  return (
    <div className="workspace-page">
      <PageHeader
        title="알림"
        description="수강 신청, 라이브 일정, 강의 공개와 녹화 처리 결과를 모아서 확인합니다."
        action={
          <button
            className="button button--soft"
            type="button"
            disabled={markAllAsRead.isPending || !counts?.unreadCount}
            onClick={() => markAllAsRead.mutate()}
          >
            모두 읽음
          </button>
        }
      />

      <div className="metric-grid">
        <MetricCard label="읽지 않음" value={counts?.unreadCount ?? '--'} />
        <MetricCard label="처리 필요" value={counts?.actionRequiredCount ?? '--'} helper="확인·처리가 남은 알림" />
      </div>

      <Panel>
        <Tabs
          className="workspace-tabs"
          idPrefix={FILTER_TAB_PREFIX}
          label="알림 필터"
          items={FILTER_TABS}
          value={filter}
          onChange={setFilter}
        />

        <div className="workspace-tabpanel" {...tabPanelProps(FILTER_TAB_PREFIX, filter)}>
          {listQuery.isPending ? (
            <p className="notification-empty">알림을 불러오는 중입니다.</p>
          ) : listQuery.isError ? (
            <InlineNotice tone={isNotImplemented(listQuery.error) ? 'warning' : 'danger'}>
              {isNotImplemented(listQuery.error)
                ? '알림 기능은 아직 준비 중입니다. 서버 연동 후 이 화면에서 전체 알림을 확인할 수 있습니다.'
                : '알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
            </InlineNotice>
          ) : (
            <>
              <NotificationList
                items={items}
                onSelect={(notification) => void activate(notification)}
                activatingId={activatingId}
                emptyMessage={emptyMessage[filter]}
                label="알림 목록"
              />
              {listQuery.hasNextPage && (
                <button
                  className="button button--soft button--full"
                  type="button"
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  {listQuery.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
                </button>
              )}
            </>
          )}
        </div>
      </Panel>
    </div>
  )
}
