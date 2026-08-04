import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({
  isMockApiEnabled: false,
  isTestMode: false,
  isNetworkBlocked: false,
}))

import { httpRecordedLessonService } from '@/features/recorded-lesson/httpRecordedLessonService'

describe('녹화강의 상세 HTTP 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('강사 처리 상태를 전용 endpoint에서 읽어 화면 모델로 옮긴다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        lessonId: 'les-recorded',
        recordedVideoId: 'video-1',
        jobId: 'job-1',
        status: 'TRANSCODING',
        failureCode: null,
        durationMs: null,
        sizeBytes: null,
        readyAt: null,
        captionStatus: 'PROCESSING',
        captionFailureCode: null,
        captionProcessedChunks: 1,
        captionTotalChunks: 4,
        captionReadyAt: null,
        recordedPublicationStatus: 'DRAFT',
        publishedAt: null,
      },
    } as never)

    await expect(httpRecordedLessonService.getProcessing('les-recorded')).resolves.toMatchObject({
      lessonId: 'les-recorded',
      status: 'TRANSCODING',
      jobId: 'job-1',
    })
    expect(get).toHaveBeenCalledWith('/instructor/recorded-lessons/les-recorded/processing')
  })

  it('실패 작업 재시도는 전용 POST endpoint를 호출한다', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        lessonId: 'les-recorded',
        recordedVideoId: 'video-1',
        jobId: 'job-2',
        status: 'QUEUED',
        failureCode: null,
        durationMs: null,
        sizeBytes: null,
        readyAt: null,
        captionStatus: 'READY',
        captionFailureCode: null,
        captionProcessedChunks: 4,
        captionTotalChunks: 4,
        captionReadyAt: '2026-08-04T00:00:00Z',
        recordedPublicationStatus: 'DRAFT',
        publishedAt: null,
      },
    } as never)

    await expect(httpRecordedLessonService.retryProcessing('les-recorded')).resolves.toMatchObject({
      status: 'QUEUED',
      jobId: 'job-2',
    })
    expect(post).toHaveBeenCalledWith('/instructor/recorded-lessons/les-recorded/processing/retry')
  })

  it('READY 재생은 라이브 playback이 아닌 recorded playback endpoint를 사용한다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        lessonId: 'les-recorded',
        recordedVideoId: 'video-1',
        durationMs: 60_000,
        recordedPublicationStatus: 'PUBLISHED',
        source: {
          url: '/api/lessons/les-recorded/recorded-playback/manifest',
          availableFromMs: 0,
          availableToMs: 60_000,
        },
        captions: {
          status: 'AVAILABLE',
          tracks: [{
            trackId: 'track-1',
            language: 'ko',
            label: '한국어',
            kind: 'subtitles',
            format: 'WEBVTT',
            url: '/api/lessons/les-recorded/recorded-playback/captions/track-1.vtt?v=1',
            version: 1,
            default: true,
          }],
        },
      },
    } as never)

    await expect(httpRecordedLessonService.getPlayback('les-recorded')).resolves.toMatchObject({
      durationMs: 60_000,
      source: { availableFromMs: 0, availableToMs: 60_000 },
      captions: { status: 'AVAILABLE', tracks: [{ format: 'WEBVTT' }] },
    })
    expect(get).toHaveBeenCalledWith('/lessons/les-recorded/recorded-playback')
    expect(get).not.toHaveBeenCalledWith('/lessons/les-recorded/playback')
  })

  it('구조화 자막은 녹화강의 전용 caption endpoint에서 읽는다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: [{ segmentId: 11, startMs: 3_000, endMs: 7_000, text: '  자막 본문  ' }],
    } as never)

    await expect(httpRecordedLessonService.getCaptionSegments('les-recorded')).resolves.toEqual([
      { segmentId: 11, startMs: 3_000, endMs: 7_000, text: '자막 본문' },
    ])
    expect(get).toHaveBeenCalledWith('/lessons/les-recorded/recorded-playback/captions')
  })

  it('AI 질문은 lessonId 경로와 question·playbackMs만 보내고 Replay v2 SSE를 화면 모델로 옮긴다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { token: 'csrf-token', headerName: 'X-CSRF-TOKEN' },
    } as never)
    const responseBody = [
      'event: answer.delta',
      'data: {"requestId":"req-1","text":"설명"}',
      '',
      'event: answer.done',
      'data: {"requestId":"req-1","sources":[{"type":"CAPTION","sessionId":"video-1","startSessionMs":12000,"endSessionMs":18000,"excerpt":"근거 자막"}]}',
      '',
    ].join('\n')
    const fetchMock = vi.fn().mockResolvedValue(new Response(responseBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const events: Array<{ type: string; payload: unknown }> = []

    await httpRecordedLessonService.askAi('les-recorded', '이 부분은 뭐야?', 15_000, {
      onEvent: (event) => events.push(event),
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/lessons/les-recorded/ai/answers/stream', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'csrf-token' }),
      body: JSON.stringify({ question: '이 부분은 뭐야?', playbackMs: 15_000 }),
    }))
    expect(events).toEqual([
      { type: 'answer.delta', payload: { requestId: 'req-1', text: '설명' } },
      {
        type: 'answer.done',
        payload: {
          requestId: 'req-1',
          sources: [{
            type: 'CAPTION',
            sessionId: 'video-1',
            // v2는 sttSessionId를 주지 않는다 — 카드 key용 합성값이라 두 갈래(녹화강의·라이브 다시보기)가
            // 같은 리더를 쓰면서 중립 접두사로 바뀌었다(ADR-0075).
            sttSessionId: 'replay:video-1',
            startMs: 12_000,
            endMs: 18_000,
            excerpt: '근거 자막',
            timeAxis: 'PLAYBACK',
          }],
        },
      },
    ])
  })
})
