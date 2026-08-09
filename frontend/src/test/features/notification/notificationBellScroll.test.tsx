import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import NotificationBell from '@/features/notification/NotificationBell'
import type { NotificationItem } from '@/features/notification/types'

/**
 * 종 아이콘의 목록은 <b>끝까지 스크롤해서 다 볼 수 있다</b>.
 *
 * <p>예전에는 최근 5건만 받고 나머지는 알림 페이지로 가야 했다. 그런데 종을 누르는 이유가 대개
 * "방금 뭐 왔지"라, 5건에서 잘리면 <b>조금 전에 본 알림이 사라진 것처럼</b> 보였다.
 */
const listQuery = vi.hoisted(() => ({
  data: { pages: [] as { items: NotificationItem[] }[] },
  hasNextPage: false,
  isFetchingNextPage: false,
  isPending: false,
  isError: false,
  error: null as unknown,
  fetchNextPage: vi.fn(),
}))

vi.mock('@/features/notification/useNotificationQueries', () => ({
  useNotificationSummaryQuery: () => ({ data: { unreadCount: 0 } }),
  useNotificationListQuery: () => listQuery,
}))
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', role: 'STUDENT' } }) }))
vi.mock('@/features/notification/useNotificationActivation', () => ({
  useNotificationActivation: () => ({ activate: vi.fn(), activatingId: null }),
}))
vi.mock('@/features/notification/useNotificationMutations', () => ({
  useMarkAllNotificationsReadMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/features/notification/usePushSubscription', () => ({ usePushSubscription: () => ({}) }))
vi.mock('@/features/notification/useNotificationRealtime', () => ({ useNotificationRealtime: () => {} }))

function item(id: string): NotificationItem {
  return {
    notificationId: id,
    recipientId: 'u1',
    type: 'LIVE_STARTING_SOON',
    readStatus: 'UNREAD',
    actionStatus: 'INFO',
    severity: 'NORMAL',
    title: `알림 ${id}`,
    message: '본문',
    targets: {},
    groupKey: `g-${id}`,
    createdAt: '2026-08-09T10:00:00+09:00',
    readAt: null,
    completedAt: null,
    scheduleChange: null,
  }
}

function open(pages: NotificationItem[][], rest: Partial<typeof listQuery> = {}) {
  listQuery.data = { pages: pages.map((items) => ({ items })) }
  listQuery.hasNextPage = rest.hasNextPage ?? false
  listQuery.isFetchingNextPage = rest.isFetchingNextPage ?? false
  listQuery.fetchNextPage = vi.fn()
  const view = render(<MemoryRouter><NotificationBell /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '알림' }))
  return view
}

/** 스크롤 컨테이너는 목록(<ul>) 자체다. jsdom은 레이아웃이 없어 크기를 직접 심는다. */
function scrollToBottom(list: HTMLElement, { atBottom = true } = {}) {
  Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(list, 'scrollTop', { value: atBottom ? 600 : 0, configurable: true })
  fireEvent.scroll(list)
}

describe('알림 드롭다운 무한 스크롤', () => {
  it('여러 장을 이어 붙여 보여 준다', () => {
    open([[item('a'), item('b')], [item('c')]])

    const list = screen.getByRole('list', { name: '알림' })
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('알림 c')).toBeInTheDocument()
  })

  it('바닥에 가까워지면 다음 장을 당긴다', () => {
    open([[item('a')]], { hasNextPage: true })

    scrollToBottom(screen.getByRole('list', { name: '알림' }))

    expect(listQuery.fetchNextPage).toHaveBeenCalled()
  })

  /** 위쪽에 머무는 동안 당기면 읽고 있는 자리가 계속 밀린다. */
  it('위에 있을 때는 당기지 않는다', () => {
    open([[item('a')]], { hasNextPage: true })

    scrollToBottom(screen.getByRole('list', { name: '알림' }), { atBottom: false })

    expect(listQuery.fetchNextPage).not.toHaveBeenCalled()
  })

  it('이미 당기는 중이면 또 당기지 않는다', () => {
    open([[item('a')]], { hasNextPage: true, isFetchingNextPage: true })

    scrollToBottom(screen.getByRole('list', { name: '알림' }))

    expect(listQuery.fetchNextPage).not.toHaveBeenCalled()
  })

  it('더 없으면 끝이라고 말한다', () => {
    open([[item('a')]])

    expect(screen.getByText('여기까지입니다.')).toBeInTheDocument()
  })

  it('당기는 동안에는 그 사실을 알린다', () => {
    open([[item('a')]], { hasNextPage: true, isFetchingNextPage: true })

    expect(screen.getByRole('status').textContent).toContain('불러오는 중')
  })
})
