import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpRecordedLessonService } from '@/features/recorded-lesson/httpRecordedLessonService'

describe('녹화강의 상세 HTTP 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
})
