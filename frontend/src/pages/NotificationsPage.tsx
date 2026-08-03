import { useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import NotificationList from '@/features/notification/NotificationList'
import { ACTION_REQUIRED_LABEL } from '@/features/notification/notificationPresentation'
import type { NotificationReadFilter, NotificationScope } from '@/features/notification/types'
import { useNotificationActivation } from '@/features/notification/useNotificationActivation'
import { useMarkAllNotificationsReadMutation } from '@/features/notification/useNotificationMutations'
import { useNotificationListQuery } from '@/features/notification/useNotificationQueries'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

const SCOPE_TAB_PREFIX = 'notification-scope'
const READ_TAB_PREFIX = 'notification-read'

/**
 * 2차 탭 — 읽음 축. `읽지 않음`이 앞이고 <b>기본값</b>이다: 알림 페이지에 들어오는 이유는 대개 아직
 * 안 본 것을 보려는 것이고, 읽은 것은 되짚어 볼 때만 필요하다.
 *
 * <p>`전체`를 두지 않는다. 두 탭이 합쳐 전체이고, 셋으로 두면 "전체와 읽지 않음이 같은데?" 하는
 * 상태(안 읽은 것만 있을 때)가 생겨 탭이 서로를 설명하지 못한다.
 */
const READ_TABS: ReadonlyArray<TabItem<NotificationReadFilter>> = [
  { id: 'UNREAD', label: '읽지 않음' },
  { id: 'READ', label: '읽음' },
]

/** 한 번에 받는 개수. 알림은 계속 쌓이므로 전체를 한 번에 불러오지 않는다. */
const PAGE_SIZE = 8

/** 두 축의 조합마다 "왜 비었는지"가 다르다 — 같은 문구를 쓰면 필터를 바꾸면 된다는 것을 알 수 없다. */
function emptyMessage(scope: NotificationScope, readState: NotificationReadFilter) {
  if (scope === 'ACTION_REQUIRED') {
    return readState === 'UNREAD'
      ? `읽지 않은 ${ACTION_REQUIRED_LABEL} 알림이 없습니다.`
      : `읽은 ${ACTION_REQUIRED_LABEL} 알림이 없습니다.`
  }
  return readState === 'UNREAD' ? '읽지 않은 알림이 없습니다.' : '읽은 알림이 없습니다.'
}

/**
 * 알림 전체 이력.
 *
 * <p>필터가 두 층이다. 1차 탭은 <b>무엇을 볼지</b>(전체 · 처리 대기), 2차 탭은 <b>어떻게 볼지</b>
 * (읽지 않음 · 읽음)이며 둘은 조합된다. 서로 다른 축을 한 줄에 늘어놓지 않는 이유는 ADR-0012에 있다.
 *
 * <p>1차 탭은 강사에게만 낸다 — `ACTION_REQUIRED`가 붙는 알림(수강 신청, 녹화 완료·실패)이 전부
 * 강사용이라 학생에게는 언제나 0건이다. 빈 탭을 남겨 두면 학생이 매번 확인하게 된다.
 */
export default function NotificationsPage() {
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const [scope, setScope] = useState<NotificationScope>('ALL')
  const [readState, setReadState] = useState<NotificationReadFilter>('UNREAD')
  const listQuery = useNotificationListQuery(scope, readState, PAGE_SIZE, true)
  const markAllAsRead = useMarkAllNotificationsReadMutation()
  const { activate, activatingId } = useNotificationActivation()
  usePageTitle('알림')

  const pages = listQuery.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  // 개수는 필터와 무관한 전체 기준이라 어느 페이지에서 읽어도 같다.
  const counts = pages[0]
  const unreadCount = counts?.unreadCount ?? 0

  /*
    건수는 탭 위에 붙인다. 머리말에 따로 숫자를 세워 두면 같은 수가 화면에 두 번 나오고, 그 숫자를
    누를 수는 없어서 "어디로 가야 그것만 볼 수 있나"를 다시 찾게 된다. 탭에 붙으면 숫자가 곧 이동 수단이다.
  */
  const scopeTabs: ReadonlyArray<TabItem<NotificationScope>> = [
    { id: 'ALL', label: '전체' },
    { id: 'ACTION_REQUIRED', label: ACTION_REQUIRED_LABEL, count: counts?.actionRequiredCount },
  ]
  const readTabs = READ_TABS.map((tab) =>
    tab.id === 'UNREAD' ? { ...tab, count: unreadCount } : tab,
  )

  return (
    <div className="workspace-page">
      <PageHeader
        title="알림"
        description="수강 신청, 라이브 일정, 강의 공개와 녹화 처리 결과를 모아서 확인합니다."
      />

      <Panel>
        {isInstructor && (
          <Tabs
            className="notification-tabs notification-tabs--scope"
            idPrefix={SCOPE_TAB_PREFIX}
            label="알림 종류"
            items={scopeTabs}
            value={scope}
            onChange={setScope}
          />
        )}

        {/*
          읽음 축과 `모두 읽음`을 같은 줄에 둔다 — 그 버튼이 바꾸는 것이 바로 이 축이다.
          1차 탭 옆에 두면 탭보다 위여서 "다른 탭까지 건드린다"고 읽힌다(ADR-0012).
        */}
        <div className="notification-toolbar">
          <Tabs
            className="notification-tabs notification-tabs--read"
            idPrefix={READ_TAB_PREFIX}
            label="읽음 상태"
            items={readTabs}
            value={readState}
            onChange={setReadState}
          />
          <button
            className="button button--soft button--small"
            type="button"
            disabled={markAllAsRead.isPending || unreadCount === 0}
            onClick={() => markAllAsRead.mutate()}
          >
            모두 읽음
          </button>
        </div>

        {/* 두 탭 묶음 중 안쪽(읽음 축)을 패널로 잇는다 — 목록이 직접 바뀌는 축이다. */}
        <div className="notification-panel-body" {...tabPanelProps(READ_TAB_PREFIX, readState)}>
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
                emptyMessage={emptyMessage(scope, readState)}
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
