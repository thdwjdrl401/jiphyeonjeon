import { useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import NotificationList from '@/features/notification/NotificationList'
import type { NotificationScope } from '@/features/notification/types'
import { useNotificationActivation } from '@/features/notification/useNotificationActivation'
import { useMarkAllNotificationsReadMutation } from '@/features/notification/useNotificationMutations'
import { useNotificationListQuery } from '@/features/notification/useNotificationQueries'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

/**
 * 업무 처리 축의 탭. <b>강사에게만 보인다</b> — `ACTION_REQUIRED`가 붙는 알림(수강 신청, 녹화 완료·실패)은
 * 전부 강사용이라 학생에게는 이 탭이 항상 0건이다. 언제나 빈 탭을 남겨 두면 "여기 뭔가 있어야 하나"를
 * 학생이 매번 확인하게 된다.
 *
 * <p>읽음 여부는 <b>이 탭에 넣지 않는다.</b> 그건 "무엇을 볼지"가 아니라 "어떻게 볼지"이고, 두 축을
 * 형제 탭으로 늘어놓으면 "확인 필요한 것 중 안 읽은 것"을 고를 수 없다 — 아래 체크박스가 그 축을 맡는다.
 */
const SCOPE_TABS: ReadonlyArray<TabItem<NotificationScope>> = [
  { id: 'ALL', label: '전체' },
  { id: 'ACTION_REQUIRED', label: '확인 필요' },
]

const SCOPE_TAB_PREFIX = 'notification-scope'

/** 한 번에 받는 개수. 알림은 계속 쌓이므로 전체를 한 번에 불러오지 않는다. */
const PAGE_SIZE = 8

/** 두 축의 조합마다 "왜 비었는지"가 다르다 — 같은 문구를 쓰면 필터를 끄면 된다는 것을 알 수 없다. */
function emptyMessage(scope: NotificationScope, unreadOnly: boolean) {
  if (scope === 'ACTION_REQUIRED') {
    return unreadOnly ? '읽지 않은 확인 필요 알림이 없습니다.' : '확인이 필요한 알림이 없습니다.'
  }
  return unreadOnly ? '읽지 않은 알림이 없습니다.' : '아직 받은 알림이 없습니다.'
}

/**
 * 알림 전체 이력.
 *
 * <p>목록·줄 컴포넌트는 학생·강사가 공유한다. 역할로 갈리는 것은 <b>업무 처리 탭이 있는지</b>뿐이고,
 * 어떤 알림이 보이는지는 서버가 수신자로 걸러 준다.
 */
export default function NotificationsPage() {
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const [scope, setScope] = useState<NotificationScope>('ALL')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const listQuery = useNotificationListQuery(scope, unreadOnly, PAGE_SIZE, true)
  const markAllAsRead = useMarkAllNotificationsReadMutation()
  const { activate, activatingId } = useNotificationActivation()
  usePageTitle('알림')

  const pages = listQuery.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  // 개수는 필터와 무관한 전체 기준이라 어느 페이지에서 읽어도 같다.
  const counts = pages[0]
  const unreadCount = counts?.unreadCount ?? 0

  return (
    <div className="workspace-page">
      {/*
        머리말에는 "지금 몇 건 남았나"만 둔다. `모두 읽음`은 여기가 아니라 목록 도구줄에 있다 —
        페이지 제목 옆에 두면 탭·필터보다 위에 있어서 "지금 보고 있는 것"이 아니라 화면 전체(다른 탭까지)를
        건드리는 버튼처럼 읽힌다. 실제로는 그렇지 않고, 계정의 모든 알림을 읽음으로 바꾼다.
      */}
      <PageHeader
        title="알림"
        description="수강 신청, 라이브 일정, 강의 공개와 녹화 처리 결과를 모아서 확인합니다."
        action={
          <dl className="notification-counts">
            <div>
              <dt>읽지 않음</dt>
              <dd>{counts ? unreadCount : '--'}</dd>
            </div>
            {isInstructor && (
              <div>
                <dt>확인 필요</dt>
                <dd>{counts?.actionRequiredCount ?? '--'}</dd>
              </div>
            )}
          </dl>
        }
      />

      <Panel>
        {/*
          도구줄 한 줄에 세 가지가 순서대로 온다: 무엇을 볼지(탭) → 어떻게 볼지(읽음 필터) →
          목록에 하는 행동(모두 읽음). 왼쪽에서 오른쪽으로 범위가 좁아진다.
        */}
        <div className="notification-toolbar">
          {isInstructor ? (
            <Tabs
              className="notification-tabs"
              idPrefix={SCOPE_TAB_PREFIX}
              label="알림 종류"
              items={SCOPE_TABS}
              value={scope}
              onChange={setScope}
            />
          ) : <span />}

          <div className="notification-toolbar__actions">
            <label className="notification-unread-toggle">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)}
              />
              <span>읽지 않음만</span>
            </label>
            <button
              className="text-button"
              type="button"
              disabled={markAllAsRead.isPending || unreadCount === 0}
              onClick={() => markAllAsRead.mutate()}
            >
              모두 읽음
            </button>
          </div>
        </div>

        {/*
          탭이 있을 때만 tabpanel로 잇는다. 학생 화면에는 탭이 없으므로 tabpanel이라고 알리면
          스크린리더가 존재하지 않는 탭 묶음을 찾는다.
        */}
        <div
          className="notification-panel-body"
          {...(isInstructor ? tabPanelProps(SCOPE_TAB_PREFIX, scope) : {})}
        >
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
                emptyMessage={emptyMessage(scope, unreadOnly)}
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
