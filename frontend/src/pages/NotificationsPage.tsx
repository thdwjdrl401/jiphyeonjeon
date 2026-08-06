import { useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import BrowserNotificationToggle from '@/features/notification/BrowserNotificationToggle'
import NotificationList from '@/features/notification/NotificationList'
import { buildCategoryFilters } from '@/features/notification/notificationPresentation'
import type { NotificationReadFilter } from '@/features/notification/types'
import { useNotificationActivation } from '@/features/notification/useNotificationActivation'
import { useMarkAllNotificationsReadMutation } from '@/features/notification/useNotificationMutations'
import { useNotificationListQuery } from '@/features/notification/useNotificationQueries'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

const READ_TAB_PREFIX = 'notification-read'

/**
 * 유일한 탭 축 — 읽음. `읽지 않음`이 앞이고 <b>기본값</b>이다: 알림 페이지에 들어오는 이유는 대개
 * 아직 안 본 것을 보려는 것이고, 읽은 것은 되짚어 볼 때만 필요하다.
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

/** 태그를 고르지 않은 상태. */
const ALL_CATEGORIES = '__ALL__'

/**
 * 태그를 고른 동안 자동으로 당겨올 페이지 수의 상한.
 *
 * <p>서버는 태그로 걸러 주지 않는다(`GET /api/me/notifications`는 scope·readState만 받는다). 그래서
 * 태그 필터는 <b>이미 받은 목록</b>에 적용되는데, 8건만 받아 둔 상태에서 "라이브 임박 없음"이라고
 * 말하면 다음 페이지에 있는 것을 없다고 하는 거짓이 된다. 태그를 고르면 다음 페이지를 알아서
 * 당겨 그 거짓을 막는다.
 *
 * <p>상한을 두는 이유는 오래 쓴 계정에서 알림이 수백 건이면 전부 받게 되기 때문이다. 여기까지
 * 당긴 뒤에도 더 있으면 `더 보기`로 이어진다.
 */
const AUTO_FETCH_PAGE_LIMIT = 5

/**
 * 왜 비었는지를 말한다 — 같은 문구를 쓰면 필터를 바꾸면 된다는 것을 알 수 없다.
 * 고른 태그가 있으면 그 말을 넣는다(`읽지 않은 라이브 임박 알림이 없습니다`).
 */
export function emptyMessage(readState: NotificationReadFilter, categoryLabel: string | null) {
  const readPrefix = readState === 'UNREAD' ? '읽지 않은' : '읽은'
  return categoryLabel
    ? `${readPrefix} ${categoryLabel} 알림이 없습니다.`
    : `${readPrefix} 알림이 없습니다.`
}

/**
 * 알림 전체 이력.
 *
 * <p>필터는 두 줄이다. 탭은 <b>읽음 축</b>(읽지 않음 · 읽음)이고, 그 아래 칩은 <b>종류</b>이며 둘은
 * 조합된다. 서로 다른 축을 한 줄에 늘어놓지 않는 이유는 ADR-0012에 있다.
 *
 * <p>한때 그 위에 `전체 · 처리 대기` 탭이 한 줄 더 있었다(강사 전용). 종류 칩이 들어오면서 필터가
 * 세 줄이 되어 무엇이 상위인지 읽히지 않아 걷었다 — 처리 대기는 목록의 배지로 계속 보이고, 강사가
 * 처리할 알림은 대개 `수강 신청` 칩으로 좁혀 찾는다.
 */
export default function NotificationsPage() {
  // 역할로 칩 구성을 가른다 — 강사와 학생이 받는 알림 종류가 다르다.
  const { user } = useAuth()
  const [readState, setReadState] = useState<NotificationReadFilter>('UNREAD')
  const [category, setCategory] = useState<string>(ALL_CATEGORIES)
  // 업무 처리 축은 화면에서 고르지 않는다 — 목록은 언제나 전체를 받고 읽음 축·종류로만 좁힌다.
  const listQuery = useNotificationListQuery('ALL', readState, PAGE_SIZE, true)
  const markAllAsRead = useMarkAllNotificationsReadMutation()
  const { activate, activatingId } = useNotificationActivation()
  usePageTitle('알림')

  const pages = listQuery.data?.pages ?? []
  const loaded = pages.flatMap((page) => page.items)

  /*
    칩은 <b>그 역할이 받는 모든</b> 종류를 만든다. 강사에게는 수강 신청·녹화가, 학생에게는 수강 승인·
    학습 자료·다시보기가 오므로 두 화면의 칩 구성이 다르다(NOTIFICATION_AUDIENCE). 지금 목록에 없는
    종류도 남겨 흐리게 내면, 이 화면에 어떤 알림이 오는지가 한눈에 보인다.

    종류가 12개뿐이라 렌더마다 세도 싸다(메모하면 목록 배열이 매번 새로워 의존성이 더 지저분해진다).
  */
  const categoryFilters = buildCategoryFilters(loaded.map((item) => item.type), user?.role)
  const selectedFilter = categoryFilters.find((filter) => filter.label === category) ?? null
  const items = selectedFilter
    ? loaded.filter((item) => selectedFilter.types.includes(item.type))
    : loaded

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listQuery

  /* 태그를 고른 동안에는 다음 페이지를 알아서 당긴다 — 위 AUTO_FETCH_PAGE_LIMIT 주석 참조. */
  useEffect(() => {
    if (category === ALL_CATEGORIES) return
    if (!hasNextPage || isFetchingNextPage) return
    if (pages.length >= AUTO_FETCH_PAGE_LIMIT) return
    void fetchNextPage()
  }, [category, hasNextPage, isFetchingNextPage, fetchNextPage, pages.length])
  // 개수는 필터와 무관한 전체 기준이라 어느 페이지에서 읽어도 같다.
  const unreadCount = pages[0]?.unreadCount ?? 0

  /*
    건수는 탭에 붙인다. 머리말에 따로 숫자를 세워 두면 같은 수가 화면에 두 번 나오고, 그 숫자를
    누를 수는 없어서 "어디로 가야 그것만 볼 수 있나"를 다시 찾게 된다. 탭에 붙으면 숫자가 곧 이동 수단이다.
  */
  const readTabs = READ_TABS.map((tab) =>
    tab.id === 'UNREAD' ? { ...tab, count: unreadCount } : tab,
  )

  return (
    <div className="workspace-page notifications-page">
      <PageHeader
        title="알림"
        description="수강 신청, 라이브 일정, 강의 공개와 녹화 처리 결과를 모아서 확인합니다."
        action={<BrowserNotificationToggle />}
      />

      <Panel>
        {/*
          읽음 축과 `모두 읽음`을 같은 줄에 둔다 — 그 버튼이 바꾸는 것이 바로 이 축이다.
          읽음 탭에는 바꿀 읽지 않은 알림이 없으므로 버튼을 숨긴다. 다만 자리까지 없애면 툴바 높이가
          줄어 탭과 아래 목록이 위아래로 흔들리므로, 보이지 않는 자리만 유지한다.
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
            className={`button button--soft button--small notification-toolbar__mark-all${readState === 'READ' ? ' notification-toolbar__mark-all--hidden' : ''}`}
            type="button"
            aria-hidden={readState === 'READ' || undefined}
            tabIndex={readState === 'READ' ? -1 : undefined}
            disabled={readState === 'READ' || markAllAsRead.isPending || unreadCount === 0}
            onClick={() => markAllAsRead.mutate()}
          >
            모두 읽음
          </button>
        </div>

        {/*
          종류 줄. 탭이 아니라 <b>칩</b>으로 둔다 — 탭은 화면을 갈라 보여 주는 축(읽지 않음·읽음)이고,
          이건 그 안에서 종류를 좁히는 아래 층이다. 둘을 같은 모양으로 만들면 어느 줄이 상위인지
          읽히지 않는다(ADR-0012).

          <b>모든 종류를 늘 보여 준다.</b> 지금 목록에 없는 종류는 흐리게 두어, 이 화면에 어떤 알림이
          오는지를 한눈에 알 수 있게 한다. 흐린 칩도 누를 수 있다 — 건수는 지금까지 불러온 목록에서
          센 값이라, 막아 버리면 다음 페이지에 있는 알림을 고를 수 없다.

          누른 칩을 다시 누르면 풀린다. `전체` 칩을 따로 두지 않는 이유는 아무것도 눌리지 않은 상태가
          이미 전체이기 때문이다.
        */}
        <div className="notification-categories" role="group" aria-label="알림 종류로 좁히기">
          {categoryFilters.map((filter) => {
            const isActive = filter.label === category
            return (
              <button
                key={filter.label}
                className={`notification-category${isActive ? ' is-active' : ''}${filter.count === 0 ? ' is-empty' : ''}`}
                type="button"
                aria-pressed={isActive}
                /*
                  있음·없음을 글자로도 알린다. 선명함과 빨간 점은 색·모양이라 그것만으로는
                  전달되지 않는다(색각 이상, 스크린 리더).
                */
                title={filter.count === 0
                  ? `${filter.label} 알림이 없습니다`
                  : `${filter.label} ${filter.count}건`}
                onClick={() => setCategory(isActive ? ALL_CATEGORIES : filter.label)}
              >
                {filter.label}
              </button>
            )
          })}
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
                emptyMessage={emptyMessage(readState, selectedFilter?.label ?? null)}
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
