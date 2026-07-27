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

  it('세션별 라이브 DVR 재생 주소를 조회하고 시간축 정보를 매핑한다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        sessionId: 'ses-live-1',
        playbackUrl: '/api/live-sessions/ses-live-1/playback/manifest.m3u8',
        mimeType: 'application/vnd.apple.mpegurl',
        streamType: 'LIVE_DVR',
        sessionOffsetMs: 1_250,
      },
    } as never)

    await expect(httpLiveSessionService.getLivePlayback('ses-live-1')).resolves.toEqual({
      sessionId: 'ses-live-1',
      playbackUrl: '/api/live-sessions/ses-live-1/playback/manifest.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      streamType: 'LIVE_DVR',
      sessionOffsetMs: 1_250,
    })
    expect(get).toHaveBeenCalledWith('/live-sessions/ses-live-1/playback')
  })

  it('다른 세션이나 빈 재생 주소가 오면 샘플로 대체하지 않고 계약 오류를 낸다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        sessionId: 'ses-live-2',
        playbackUrl: '',
        mimeType: 'application/vnd.apple.mpegurl',
        streamType: 'LIVE_DVR',
        sessionOffsetMs: null,
      },
    } as never)

    await expect(httpLiveSessionService.getLivePlayback('ses-live-1')).rejects.toMatchObject({
      code: 'LIVE_PLAYBACK_CONTRACT_INVALID',
    })
  })
})

describe('라이브 세션 Mock 재생', () => {
  it('Mock에서만 요청한 세션 ID와 예시 HLS를 반환한다', async () => {
    await expect(mockLiveSessionService.getLivePlayback('ses-mock-2')).resolves.toEqual({
      sessionId: 'ses-mock-2',
      playbackUrl: 'https://files.vidstack.io/sprite-fight/hls/stream.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      streamType: 'LIVE_DVR',
      sessionOffsetMs: 0,
    })
  })
})
