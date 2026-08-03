import { ApiError } from '@/shared/api/client'
import type {
  RecordedLessonService,
  RecordedProcessingStatus,
  RecordedProcessingView,
} from './recordedLessonService.interface'

const processingStates = new Map<string, RecordedProcessingView>()

function defaultProcessing(lessonId: string): RecordedProcessingView {
  return {
    lessonId,
    recordedVideoId: `recorded-${lessonId}`,
    jobId: `job-${lessonId}`,
    status: 'READY',
    failureCode: null,
    durationMs: 3_600_000,
    sizeBytes: 128 * 1024 * 1024,
    readyAt: '2026-08-03T15:00:00+09:00',
  }
}

export function resetMockRecordedLessons() {
  processingStates.clear()
}

export function setMockRecordedProcessing(
  lessonId: string,
  status: RecordedProcessingStatus,
  failureCode: string | null = null,
) {
  const current = processingStates.get(lessonId) ?? defaultProcessing(lessonId)
  processingStates.set(lessonId, {
    ...current,
    status,
    failureCode,
    durationMs: status === 'READY' ? current.durationMs : null,
    sizeBytes: status === 'READY' ? current.sizeBytes : null,
    readyAt: status === 'READY' ? current.readyAt : null,
  })
}

export const mockRecordedLessonService = {
  async getProcessing(lessonId) {
    return processingStates.get(lessonId) ?? defaultProcessing(lessonId)
  },
  async retryProcessing(lessonId) {
    const current = processingStates.get(lessonId) ?? defaultProcessing(lessonId)
    if (current.status !== 'FAILED') {
      throw new ApiError(
        '실패한 녹화강의만 다시 처리할 수 있습니다.',
        409,
        'RECORDED_VIDEO_RETRY_CONFLICT',
      )
    }
    const queued: RecordedProcessingView = {
      ...current,
      jobId: `job-${lessonId}-retry-${Date.now()}`,
      status: 'QUEUED',
      failureCode: null,
      durationMs: null,
      sizeBytes: null,
      readyAt: null,
    }
    processingStates.set(lessonId, queued)
    return queued
  },
  async getPlayback(lessonId) {
    const processing = processingStates.get(lessonId) ?? defaultProcessing(lessonId)
    if (processing.status !== 'READY') {
      throw new ApiError(
        '녹화강의 영상이 아직 준비되지 않았습니다.',
        409,
        'RECORDED_VIDEO_NOT_READY',
      )
    }
    return {
      lessonId,
      recordedVideoId: processing.recordedVideoId,
      durationMs: processing.durationMs ?? 3_600_000,
      source: {
        url: `/api/lessons/${lessonId}/recorded-playback/manifest`,
        availableFromMs: 0,
        availableToMs: processing.durationMs ?? 3_600_000,
      },
    }
  },
} satisfies RecordedLessonService
