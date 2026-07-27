import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'
import { apiClient } from '@/shared/api/client'

describe('라이브 세션 HTTP 서비스 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('강의 시작과 종료를 세션 상태 전이 API로 요청한다', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never)

    await httpLiveSessionService.startLiveSession('ses-live-1')
    await httpLiveSessionService.endLiveSession('ses-live-1')

    expect(post).toHaveBeenNthCalledWith(1, '/live-sessions/ses-live-1/start')
    expect(post).toHaveBeenNthCalledWith(2, '/live-sessions/ses-live-1/end')
  })

  it('LiveKit 토큰 응답의 camelCase 필드를 SDK 연결 값으로 매핑한다', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        livekitUrl: 'wss://live.example.test',
        accessToken: 'publisher-token',
      },
    } as never)

    await expect(httpLiveSessionService.getLiveToken('ses-live-1')).resolves.toEqual({
      wsUrl: 'wss://live.example.test',
      token: 'publisher-token',
    })
    expect(post).toHaveBeenCalledWith('/live-sessions/ses-live-1/token')
  })
})
