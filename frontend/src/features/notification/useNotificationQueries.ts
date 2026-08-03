import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getNotificationSummary, getNotifications } from './notificationService'
import type { NotificationReadFilter, NotificationScope } from './types'

export const notificationQueryKeys = {
  all: ['notifications'] as const,
  summary: ['notifications', 'summary'] as const,
  recent: (size: number) => ['notifications', 'recent', size] as const,
  // 두 필터 축이 각각 키에 들어간다 — 하나로 합치면 "처리 대기 + 읽지 않음"이 다른 조합의 캐시를 덮는다.
  list: (scope: NotificationScope, readState: NotificationReadFilter, size: number) =>
    ['notifications', 'list', scope, readState, size] as const,
}

/** 드롭다운이 여는 순간 목록을 받으면 늦다. 종은 개수만 미리 들고 있는다. */
const SUMMARY_REFETCH_MS = 60_000

/**
 * 헤더 배지용 개수.
 *
 * <p>폴링이다 — 서버가 아직 알림 push(WS/SSE) 채널을 갖고 있지 않다. 주기를 1분으로 둔 이유는
 * 알림이 "지금 당장" 필요한 정보가 아니고(급한 것은 화면 안 토스트가 맡는다), 짧게 잡으면 로그인한
 * 모든 탭이 서버를 두드리기 때문이다. push가 생기면 이 폴링을 지우고 구독으로 바꾼다.
 *
 * <p>재시도하지 않는다: 서버에 알림 API가 아직 없어(501) 실패가 정상 경로다. 재시도는 그 실패를
 * 세 배로 늘리기만 한다.
 */
export function useNotificationSummaryQuery(enabled: boolean) {
  return useQuery({
    queryKey: notificationQueryKeys.summary,
    queryFn: getNotificationSummary,
    enabled,
    retry: false,
    refetchInterval: enabled ? SUMMARY_REFETCH_MS : false,
    staleTime: 30_000,
  })
}

/** 드롭다운의 "최근 알림". 전체 이력과 필터는 알림 페이지가 맡으므로 첫 페이지만 받는다. */
export function useRecentNotificationsQuery(size: number, enabled: boolean) {
  return useQuery({
    queryKey: notificationQueryKeys.recent(size),
    queryFn: () => getNotifications({ page: 0, size }),
    enabled,
    retry: false,
  })
}

/**
 * 알림 페이지 목록. `더 보기`로 페이지를 이어 붙인다 — 목록 전체를 한 번에 불러오지 않는다.
 *
 * <p>`scope`(무엇을 볼지)와 `readState`(어떻게 볼지)를 따로 받는다. 화면에서도 1차·2차 탭으로
 * 나뉘어 있어 서로 조합된다.
 */
export function useNotificationListQuery(
  scope: NotificationScope,
  readState: NotificationReadFilter,
  size: number,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: notificationQueryKeys.list(scope, readState, size),
    queryFn: ({ pageParam }) => getNotifications({ scope, readState, page: pageParam, size }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.hasNext ? lastPage.page + 1 : undefined),
    enabled,
    retry: false,
  })
}
