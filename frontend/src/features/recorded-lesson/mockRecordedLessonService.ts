import { ApiError } from '@/shared/api/client'
import type {
  RecordedLessonService,
  RecordedCaptionStatus,
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
    captionStatus: 'READY',
    captionFailureCode: null,
    captionProcessedChunks: 4,
    captionTotalChunks: 4,
    captionReadyAt: '2026-08-03T15:01:00+09:00',
    recordedPublicationStatus: 'PUBLISHED',
    publishedAt: '2026-08-03T15:01:00+09:00',
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
    recordedPublicationStatus: status === 'READY' && current.captionStatus !== 'FAILED'
      ? 'PUBLISHED'
      : 'DRAFT',
    publishedAt: status === 'READY' && current.captionStatus !== 'FAILED'
      ? current.publishedAt
      : null,
  })
}

export function setMockRecordedCaptionProcessing(
  lessonId: string,
  captionStatus: RecordedCaptionStatus,
  captionFailureCode: string | null = null,
) {
  const current = processingStates.get(lessonId) ?? defaultProcessing(lessonId)
  const published = current.status === 'READY' && (captionStatus === 'READY' || captionStatus === 'EMPTY')
  processingStates.set(lessonId, {
    ...current,
    captionStatus,
    captionFailureCode,
    captionReadyAt: captionStatus === 'READY' || captionStatus === 'EMPTY' ? current.captionReadyAt : null,
    recordedPublicationStatus: published ? 'PUBLISHED' : 'DRAFT',
    publishedAt: published ? current.publishedAt : null,
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
      recordedPublicationStatus: 'DRAFT',
      publishedAt: null,
    }
    processingStates.set(lessonId, queued)
    return queued
  },
  async retryCaptions(lessonId) {
    const current = processingStates.get(lessonId) ?? defaultProcessing(lessonId)
    if (current.recordedPublicationStatus === 'PUBLISHED' || current.captionStatus !== 'FAILED') {
      throw new ApiError(
        '게시 전 실패한 자막만 다시 처리할 수 있습니다.',
        409,
        'RECORDED_CAPTION_RETRY_CONFLICT',
      )
    }
    const pending: RecordedProcessingView = {
      ...current,
      captionStatus: 'PENDING',
      captionFailureCode: null,
      captionProcessedChunks: 0,
      captionTotalChunks: null,
      captionReadyAt: null,
    }
    processingStates.set(lessonId, pending)
    return pending
  },
  async getPlayback(lessonId) {
    const processing = processingStates.get(lessonId) ?? defaultProcessing(lessonId)
    if (processing.recordedPublicationStatus !== 'PUBLISHED') {
      throw new ApiError(
        '녹화강의 영상과 자막이 아직 게시되지 않았습니다.',
        409,
        'RECORDED_VIDEO_NOT_PUBLISHED',
      )
    }
    return {
      lessonId,
      recordedVideoId: processing.recordedVideoId,
      durationMs: processing.durationMs ?? 3_600_000,
      recordedPublicationStatus: 'PUBLISHED' as const,
      source: {
        url: `/api/lessons/${lessonId}/recorded-playback/manifest`,
        availableFromMs: 0,
        availableToMs: processing.durationMs ?? 3_600_000,
      },
      captions: processing.captionStatus === 'EMPTY'
        ? { status: 'EMPTY' as const, tracks: [] }
        : {
            status: 'AVAILABLE' as const,
            tracks: [{
              trackId: `caption-${lessonId}`,
              language: 'ko',
              label: '한국어',
              kind: 'subtitles' as const,
              format: 'WEBVTT' as const,
              url: `/api/lessons/${lessonId}/recorded-playback/captions/caption-${lessonId}.vtt?v=1`,
              version: 1,
              default: true,
            }],
          },
    }
  },
} satisfies RecordedLessonService
