import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({
  isMockApiEnabled: false,
  isTestMode: false,
  isNetworkBlocked: false,
}))

import { httpNotificationService } from '@/features/notification/httpNotificationService'

const notification = {
  notificationId: 'ntf_1',
  recipientId: 'usr_1',
  type: 'ENROLLMENT_REQUESTED',
  readStatus: 'READ',
  actionStatus: 'ACTION_REQUIRED',
  severity: 'NORMAL',
  title: '수강 신청',
  message: '홍길동 님이 신청했습니다',
  targets: { curriculumId: 'cur_1', enrollmentId: 'enr_1' },
  groupKey: 'ENROLLMENT_REQUESTED:cur_1',
  createdAt: '2026-08-03T00:00:00Z',
  readAt: '2026-08-03T01:00:00Z',
  completedAt: null,
  scheduleChange: null,
}

/**
 * 알림 HTTP 어댑터 계약.
 *
 * <p>서버가 조회 네 경로를 구현했다(CONTRACT §2-4). 여기서 고정하는 것은 <b>Method·URL·파라미터</b>와
 * 응답을 <b>변환 없이</b> 통과시킨다는 사실이다 — 필드 이름을 서버와 맞춰 둔 것이 계약이므로, 중간에
 * 매핑이 끼어들면 그 합의가 조용히 깨진다.
 *
 * <p>`resolveTarget`의 `GONE`은 <b>정상 200</b>이라는 것도 여기서 고정한다. 404로 받으면 화면이
 * "삭제된 강의입니다"와 "잠시 후 다시 시도해 주세요"를 구별할 수 없다.
 */
describe('알림 HTTP 서비스 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('배지와 목록을 내 알림 경로로 조회한다', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { unreadCount: 3, actionRequiredCount: 1 },
    } as never)

    await expect(httpNotificationService.getSummary()).resolves.toEqual({
      unreadCount: 3,
      actionRequiredCount: 1,
    })
    expect(getSpy).toHaveBeenCalledWith('/me/notifications/summary')
  })

  it('두 축 필터와 페이지를 쿼리 파라미터로 넘긴다', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        items: [notification],
        page: 0,
        size: 5,
        totalElements: 1,
        totalPages: 1,
        hasNext: false,
        unreadCount: 0,
        actionRequiredCount: 1,
      },
    } as never)

    const result = await httpNotificationService.getNotifications({
      scope: 'ACTION_REQUIRED',
      readState: 'UNREAD',
      page: 2,
      size: 5,
    })

    expect(getSpy).toHaveBeenCalledWith('/me/notifications', {
      params: { scope: 'ACTION_REQUIRED', readState: 'UNREAD', page: 2, size: 5 },
    })
    // 서버 응답을 그대로 통과시킨다 — 필드 이름이 화면 타입과 같기로 한 것이 계약이다.
    expect(result.items[0]).toEqual(notification)
    expect(result.actionRequiredCount).toBe(1)
  })

  /*
   * 필터를 주지 않는 것과 "빈 값으로 거른다"는 다르다. undefined면 axios가 키를 아예 빼므로
   * 서버는 그 축으로 가리지 않고, 빈 문자열을 보내면 서버가 알 수 없는 값으로 받는다.
   */
  it('필터가 없으면 파라미터를 비워 보낸다', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { items: [], page: 0, size: 10, totalElements: 0, totalPages: 0, hasNext: false, unreadCount: 0, actionRequiredCount: 0 },
    } as never)

    await httpNotificationService.getNotifications()

    expect(getSpy).toHaveBeenCalledWith('/me/notifications', {
      params: { scope: undefined, readState: undefined, page: undefined, size: undefined },
    })
  })

  it('읽음 처리는 POST이고 개별 읽음은 갱신된 알림을 돌려준다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: notification } as never)
      .mockResolvedValueOnce({ data: { unreadCount: 0, actionRequiredCount: 1 } } as never)

    await expect(httpNotificationService.markAsRead('ntf_1')).resolves.toEqual(notification)
    await expect(httpNotificationService.markAllAsRead()).resolves.toEqual({
      unreadCount: 0,
      actionRequiredCount: 1,
    })

    expect(postSpy).toHaveBeenNthCalledWith(1, '/me/notifications/ntf_1/read')
    expect(postSpy).toHaveBeenNthCalledWith(2, '/me/notifications/read-all')
  })

  /*
   * 모두 읽음이 처리 축을 0으로 만들지 않는다는 것을 여기서도 본다. 읽었다고 할 일이 사라지면
   * 강사의 "처리 대기" 목록이 비어 버린다(서버 계약과 같은 규칙, ADR-0012).
   */
  it('모두 읽음 뒤에도 처리 대기 개수는 남는다', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { unreadCount: 0, actionRequiredCount: 2 },
    } as never)

    await expect(httpNotificationService.markAllAsRead()).resolves.toEqual({
      unreadCount: 0,
      actionRequiredCount: 2,
    })
  })

  it('대상 재판정을 알림 경로로 조회한다', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { status: 'AVAILABLE', state: { curriculumId: 'cur_1', lessonId: null }, reasonCode: null },
    } as never)

    const result = await httpNotificationService.resolveTarget('ntf_42')

    expect(getSpy).toHaveBeenCalledWith('/me/notifications/ntf_42/target')
    expect(result.status).toBe('AVAILABLE')
  })

  /*
   * 대상이 사라진 것은 오류가 아니다. 서버가 200에 이유를 담아 주므로, 어댑터는 그걸 그대로
   * 통과시키고 화면이 이유별 문구를 고른다.
   */
  it('사라진 대상은 오류가 아니라 이유가 담긴 정상 응답이다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { status: 'GONE', state: null, reasonCode: 'TARGET_DELETED' },
    } as never)

    const result = await httpNotificationService.resolveTarget('ntf_42')

    expect(result).toMatchObject({ status: 'GONE', reasonCode: 'TARGET_DELETED' })
  })
})
