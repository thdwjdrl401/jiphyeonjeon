import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'
import { mockLiveSessionService } from '@/features/live-session/mockLiveSessionService'
import { ApiError, apiClient } from '@/shared/api/client'

const SESSION_RESPONSE = {
  sessionId: 'ses-live-1',
  lessonId: 'les-1',
  liveSessionStatus: 'SCHEDULED',
  scheduledAt: '2026-08-01T10:00:00+09:00',
  entryWindowMinutes: 10,
  expectedDurationMinutes: 90,
}

const LESSON_CONTEXT_RESPONSE = {
  lessonId: 'les-1',
  sectionId: 'sec-1',
  curriculumId: 'cur-1',
  curriculumTitle: '라이브로 완성하는 Spring Boot',
  title: 'Spring Security 시작하기',
}

/** 경로별로 응답을 갈라 주는 apiClient.get 스텁. 어느 축으로 읽었는지도 함께 본다. */
function stubGet(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
    for (const [prefix, data] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) {
        return data instanceof Error ? Promise.reject(data) : Promise.resolve({ data } as never)
      }
    }
    if (path.includes('/lessons/')) return Promise.resolve({ data: LESSON_CONTEXT_RESPONSE } as never)
    return Promise.resolve({ data: SESSION_RESPONSE } as never)
  })
}

describe('라이브 세션 HTTP 서비스 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * 세션 응답은 lessonId까지만 준다 — live 모듈은 커리큘럼을 참조하지 않는다(모듈 경계).
   * 예전엔 나머지를 빈 문자열로 채워서, 사전 점검·입장 전 점검 사이드바가 커리큘럼 강의 목록 대신
   * '내 커리큘럼/내 프로필' 기본 메뉴로 떨어지고 강의 제목도 비었다.
   */
  it('세션의 커리큘럼 맥락을 기존 레슨 조회 API로 채운다', async () => {
    const get = stubGet()

    await expect(httpLiveSessionService.getLiveSession('ses-live-1')).resolves.toMatchObject({
      sessionId: 'ses-live-1',
      lessonId: 'les-1',
      lessonTitle: 'Spring Security 시작하기',
      curriculumId: 'cur-1',
      curriculumTitle: '라이브로 완성하는 Spring Boot',
      sectionId: 'sec-1',
    })
    expect(get).toHaveBeenNthCalledWith(1, '/live-sessions/ses-live-1')
    // 역할을 가리지 않고 공개 레슨 조회 하나만 쓴다. 강사 전용 경로를 타지 않으므로
    // 이 화면 때문에 BE에 필드를 더할 필요가 없다(ADR-0004).
    expect(get).toHaveBeenNthCalledWith(2, '/lessons/les-1')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('맥락 조회가 실패해도 세션 자체는 열린다', async () => {
    // 마이크 점검과 라이브 입장이라는 필수 흐름을 제목 조회 하나가 막으면 안 된다.
    stubGet({ '/lessons/': new ApiError('레슨을 찾을 수 없습니다.', 404, 'LESSON_NOT_FOUND') })

    await expect(httpLiveSessionService.getLiveSession('ses-live-1')).resolves.toMatchObject({
      sessionId: 'ses-live-1',
      status: 'SCHEDULED',
      curriculumId: '',
      lessonTitle: '',
    })
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
    const get = stubGet({
      '/live-sessions/ses-live-1/start-status': {
        operationId: 'op-1',
        attemptStatus: 'IN_PROGRESS',
        step: 'EGRESS_STARTING',
        failureCode: null,
        failureMessage: null,
        session: { ...SESSION_RESPONSE, liveSessionStatus: 'STARTING' },
      },
    })

    await expect(httpLiveSessionService.getLiveStartStatus('ses-live-1', 'op-1')).resolves.toMatchObject({
      operationId: 'op-1',
      attemptStatus: 'IN_PROGRESS',
      step: 'EGRESS_STARTING',
      // 폴링 응답도 맥락을 채워야 한다 — 안 채우면 캐시의 세션을 덮어써서
      // 시작을 누른 순간 사이드바가 기본 메뉴로 떨어진다.
      session: {
        sessionId: 'ses-live-1',
        status: 'STARTING',
        entryWindowMinutes: 10,
        curriculumId: 'cur-1',
        lessonTitle: 'Spring Security 시작하기',
      },
    })
    expect(get).toHaveBeenNthCalledWith(
      1,
      '/live-sessions/ses-live-1/start-status',
      { params: { operationId: 'op-1' } },
    )
    expect(get).toHaveBeenNthCalledWith(2, '/lessons/les-1')
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
