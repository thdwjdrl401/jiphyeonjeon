import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'
import { mockLiveSessionService } from '@/features/live-session/mockLiveSessionService'
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

  it('레슨 기준으로 재생 metadata를 조회하고 시간축 정보를 매핑한다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        lessonId: 'les-1',
        sessionId: 'ses-live-1',
        liveSessionStatus: 'LIVE',
        currentSessionMs: 3_721_000,
        sessionOffsetMs: 1_250,
        durationMs: null,
        source: {
          url: '/api/lessons/les-1/playback/manifest',
          availableFromMs: 1_250,
          availableToMs: 3_721_000,
        },
      },
    } as never)

    await expect(httpLiveSessionService.getPlayback('les-1')).resolves.toEqual({
      lessonId: 'les-1',
      sessionId: 'ses-live-1',
      liveSessionStatus: 'LIVE',
      currentSessionMs: 3_721_000,
      durationMs: null,
      source: {
        url: '/api/lessons/les-1/playback/manifest',
        availableFromMs: 1_250,
        availableToMs: 3_721_000,
      },
    })
    expect(get).toHaveBeenCalledWith('/lessons/les-1/playback')
  })

  it('source가 없으면 오류가 아니라 대기 상태로 매핑한다', async () => {
    // Egress가 첫 세그먼트를 아직 안 올린 정상 상태다. 계약 위반으로 다루면
    // 대기 화면 대신 오류 화면이 떠서 사용자가 기다릴 수 없다.
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        lessonId: 'les-1',
        sessionId: 'ses-live-1',
        liveSessionStatus: 'STARTING',
        currentSessionMs: null,
        durationMs: null,
        source: null,
      },
    } as never)

    await expect(httpLiveSessionService.getPlayback('les-1')).resolves.toMatchObject({
      liveSessionStatus: 'STARTING',
      source: null,
    })
  })

  it('다른 레슨이나 빈 재생 주소가 오면 샘플로 대체하지 않고 계약 오류를 낸다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        lessonId: 'les-2',
        sessionId: 'ses-live-1',
        liveSessionStatus: 'LIVE',
        currentSessionMs: null,
        durationMs: null,
        source: { url: '', availableFromMs: 0, availableToMs: 0 },
      },
    } as never)

    await expect(httpLiveSessionService.getPlayback('les-1')).rejects.toMatchObject({
      code: 'PLAYBACK_CONTRACT_INVALID',
    })
  })
})

describe('라이브 세션 Mock 재생', () => {
  it('Mock에서만 요청한 레슨 ID와 예시 HLS를 반환한다', async () => {
    await expect(mockLiveSessionService.getPlayback('les-mock-2')).resolves.toMatchObject({
      lessonId: 'les-mock-2',
      liveSessionStatus: 'LIVE',
      source: { url: 'https://files.vidstack.io/sprite-fight/hls/stream.m3u8' },
    })
  })
})
