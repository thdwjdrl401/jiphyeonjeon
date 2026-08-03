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
        source: {
          url: '/api/lessons/les-recorded/recorded-playback/manifest',
          availableFromMs: 0,
          availableToMs: 60_000,
        },
      },
    } as never)

    await expect(httpRecordedLessonService.getPlayback('les-recorded')).resolves.toMatchObject({
      durationMs: 60_000,
      source: { availableFromMs: 0, availableToMs: 60_000 },
    })
    expect(get).toHaveBeenCalledWith('/lessons/les-recorded/recorded-playback')
    expect(get).not.toHaveBeenCalledWith('/lessons/les-recorded/playback')
  })
})
