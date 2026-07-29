import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'
import { mockLiveSessionService } from '@/features/live-session/mockLiveSessionService'
import { apiClient } from '@/shared/api/client'

describe('라이브 세션 HTTP 서비스 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preflight 방 준비와 서버 readiness를 실제 endpoint로 요청한다', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { sessionId: 'ses-live-1', roomName: 'session-ses-live-1', roomSid: 'RM_1' },
    } as never)
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        ready: true,
        instructorPresent: true,
        microphonePublished: true,
        microphoneMuted: false,
        instructorMicrophoneTrackCount: 1,
        unexpectedMicrophonePublishers: 0,
      },
    } as never)

    await expect(httpLiveSessionService.preparePreflightRoom('ses-live-1')).resolves.toMatchObject({
      roomSid: 'RM_1',
    })
    await expect(httpLiveSessionService.getPreflightReadiness('ses-live-1')).resolves.toMatchObject({
      ready: true,
      instructorMicrophoneTrackCount: 1,
    })

    expect(post).toHaveBeenCalledWith('/instructor/live-sessions/ses-live-1/preflight')
    expect(get).toHaveBeenCalledWith('/instructor/live-sessions/ses-live-1/preflight/readiness')
  })

  it('강의 시작 202 operation을 보존하고 종료를 상태 전이 API로 요청한다', async () => {
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({
        data: { operationId: 'op-1', sessionId: 'ses-live-1', status: 'STARTING' },
      } as never)
      .mockResolvedValueOnce({ data: {} } as never)

    await expect(httpLiveSessionService.startLiveSession('ses-live-1')).resolves.toEqual({
      operationId: 'op-1',
      sessionId: 'ses-live-1',
      status: 'STARTING',
    })
    await httpLiveSessionService.endLiveSession('ses-live-1')

    expect(post).toHaveBeenNthCalledWith(1, '/live-sessions/ses-live-1/start')
    expect(post).toHaveBeenNthCalledWith(2, '/live-sessions/ses-live-1/end')
  })

  it('operationId로 STARTING 상태를 조회하고 nested session을 화면 모델로 매핑한다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        operationId: 'op-1',
        attemptStatus: 'IN_PROGRESS',
        step: 'EGRESS_STARTING',
        failureCode: null,
        failureMessage: null,
        session: {
          sessionId: 'ses-live-1',
          lessonId: 'les-1',
          liveSessionStatus: 'STARTING',
          scheduledAt: '2026-08-01T10:00:00+09:00',
          entryWindowMinutes: 10,
          expectedDurationMinutes: 90,
        },
      },
    } as never)

    await expect(httpLiveSessionService.getLiveStartStatus('ses-live-1', 'op-1')).resolves.toMatchObject({
      operationId: 'op-1',
      attemptStatus: 'IN_PROGRESS',
      step: 'EGRESS_STARTING',
      session: { sessionId: 'ses-live-1', status: 'STARTING', entryWindowMinutes: 10 },
    })
    expect(get).toHaveBeenCalledWith(
      '/live-sessions/ses-live-1/start-status',
      { params: { operationId: 'op-1' } },
    )
  })

  it('강사 LiveKit 토큰 응답의 camelCase 필드를 SDK 연결 값으로 매핑한다', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        livekitUrl: 'wss://live.example.test',
        accessToken: 'publisher-token',
      },
    } as never)

    await expect(httpLiveSessionService.getInstructorLiveToken('ses-live-1')).resolves.toEqual({
      wsUrl: 'wss://live.example.test',
      token: 'publisher-token',
    })
    expect(post).toHaveBeenCalledWith('/instructor/live-sessions/ses-live-1/token')
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
