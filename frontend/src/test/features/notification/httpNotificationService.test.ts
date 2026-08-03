import { describe, expect, it, vi } from 'vitest'
import { API_NOT_IMPLEMENTED } from '@/shared/api/notImplemented'

vi.mock('@/shared/config/runtime', () => ({
  isMockApiEnabled: false,
  isTestMode: false,
  isNetworkBlocked: false,
}))

import { httpNotificationService } from '@/features/notification/httpNotificationService'

/**
 * 알림 HTTP 어댑터의 현재 계약.
 *
 * <p>서버에 알림 도메인이 아직 없다. 그 사실을 테스트로 <b>고정</b>해 둔다 — 없는 엔드포인트를
 * 추측해 호출하거나 임의 성공 응답으로 대체하면 화면은 통과하는데 실제 연동에서 404가 난다.
 *
 * <p>서버가 생기면 이 파일은 Method·URL·DTO·응답 매핑을 검증하는 계약 테스트로 바뀐다
 * (`enrollmentService.test.ts`가 그 모양이다).
 */
describe('알림 HTTP 서비스 — 서버 미구현', () => {
  it('모든 호출이 서버 장애와 구별되는 미구현 오류를 던진다', async () => {
    const calls: Array<[string, Promise<unknown>]> = [
      ['getSummary', httpNotificationService.getSummary()],
      ['getNotifications', httpNotificationService.getNotifications()],
      ['markAsRead', httpNotificationService.markAsRead('ntf-1')],
      ['markAllAsRead', httpNotificationService.markAllAsRead()],
      ['resolveTarget', httpNotificationService.resolveTarget('ntf-1')],
    ]

    for (const [name, call] of calls) {
      await expect(call, name).rejects.toMatchObject({ status: 501, code: API_NOT_IMPLEMENTED })
    }
  })

  it('오류 메시지에 필요한 엔드포인트가 남아 있다', async () => {
    await expect(httpNotificationService.getSummary())
      .rejects.toThrow('GET /me/notifications/summary')
    await expect(httpNotificationService.markAsRead('ntf-42'))
      .rejects.toThrow('POST /me/notifications/ntf-42/read')
  })
})
