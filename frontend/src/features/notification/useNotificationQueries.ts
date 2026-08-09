import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  getNotificationPreference,
  getNotificationSummary,
  getNotifications,
} from './notificationService'
import type { NotificationReadFilter, NotificationScope } from './types'

export const notificationQueryKeys = {
  all: ['notifications'] as const,
  preferences: ['notification-preference'] as const,
  summary: ['notifications', 'summary'] as const,
  // 두 필터 축이 각각 키에 들어간다 — 하나로 합치면 "처리 대기 + 읽지 않음"이 다른 조합의 캐시를 덮는다.
  list: (scope: NotificationScope, readState: NotificationReadFilter | undefined, size: number) =>
    ['notifications', 'list', scope, readState, size] as const,
  preference: (curriculumId: string, lessonId?: string) =>
    [...notificationQueryKeys.preferences, curriculumId, lessonId ?? null] as const,
}

/** 팝오버 아이콘과 설정 내용이 같은 적용값을 공유한다. */
export function useNotificationPreferenceQuery(curriculumId: string, lessonId?: string) {
  return useQuery({
    queryKey: notificationQueryKeys.preference(curriculumId, lessonId),
    queryFn: () => getNotificationPreference(curriculumId, lessonId),
  })
}

/**
 * 헤더 배지용 개수. 드롭다운이 여는 순간 목록을 받으면 늦으므로 개수만 미리 들고 있는다.
 *
 * <p><b>폴링하지 않는다.</b> 예전에는 60초 주기로 돌았다 — 서버에 push 채널이 없던 때 만든 것이고,
 * `useNotificationRealtime`이 STOMP 구독을 붙인 뒤에도 "재연결 공백" 때문에 남겨 뒀다. 그 공백은
 * 다시 붙는 순간 한 번 다시 읽으면 메워지고, 그것은 이제 그 훅이 한다.
 *
 * <p>남겨 두면 안 되는 이유가 있었다. 이 종은 헤더에 있어서 <b>로그인한 모든 사용자의 모든 화면</b>
 * 에서 마운트되고, TanStack의 폴링은 탭이 보이는 동안 계속 돈다(`refetchIntervalInBackground` 기본
 * false = 문서가 hidden일 때만 멈춘다). 60초마다 나가는 요청은 Spring Session의 lastAccessedTime을
 * 매번 갱신하므로 30분짜리 유휴 만료 창을 서른 번 되돌린다 — 자리를 비워도 세션이 안 끊겼다.
 *
 * <p>이제 갱신 시점은 셋이다: 마운트, 창 복귀(TanStack 기본 `refetchOnWindowFocus`), 그리고 신호·
 * 재연결에 의한 무효화. 셋 다 <b>사용자가 실제로 거기 있을 때</b>만 일어난다.
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
    /*
     * 창 복귀 refetch가 이 값에 막히지 않을 만큼 짧아야 한다. 폴링이 있을 때는 60초마다 어차피
     * 새로 받아서 이 값이 의미가 적었지만, 이제는 복귀가 주된 갱신 경로 중 하나다.
     */
    staleTime: 10_000,
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
  /** 생략하면 읽음 여부로 거르지 않는다 — 드롭다운이 그 경우다(전체를 시간순으로 잇는다). */
  readState: NotificationReadFilter | undefined,
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
