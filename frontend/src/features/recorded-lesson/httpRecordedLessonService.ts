import { ApiError, apiClient } from '@/shared/api/client'
import type {
  RecordedLessonService,
  RecordedPlaybackView,
  RecordedProcessingStatus,
  RecordedProcessingView,
} from './recordedLessonService.interface'

const PROCESSING_STATUSES = new Set<RecordedProcessingStatus>([
  'AWAITING_UPLOAD',
  'QUEUED',
  'TRANSCODING',
  'VERIFYING',
  'READY',
  'FAILED',
])

function nullableNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value
}

function normalizeProcessing(data: RecordedProcessingView, lessonId: string): RecordedProcessingView {
  if (
    data.lessonId !== lessonId
    || !data.recordedVideoId
    || !PROCESSING_STATUSES.has(data.status)
  ) {
    throw new ApiError(
      '녹화강의 처리 응답이 계약과 일치하지 않습니다.',
      undefined,
      'RECORDED_PROCESSING_CONTRACT_INVALID',
    )
  }
  return {
    lessonId: data.lessonId,
    recordedVideoId: data.recordedVideoId,
    jobId: data.jobId ?? null,
    status: data.status,
    failureCode: data.failureCode ?? null,
    durationMs: nullableNumber(data.durationMs),
    sizeBytes: nullableNumber(data.sizeBytes),
    readyAt: data.readyAt ?? null,
  }
}

function normalizePlayback(data: RecordedPlaybackView, lessonId: string): RecordedPlaybackView {
  const sourceUrl = data.source?.url?.trim()
  if (
    data.lessonId !== lessonId
    || !data.recordedVideoId
    || !Number.isFinite(data.durationMs)
    || data.durationMs <= 0
    || !sourceUrl
    || !Number.isFinite(data.source.availableFromMs)
    || !Number.isFinite(data.source.availableToMs)
  ) {
    throw new ApiError(
      '녹화강의 재생 응답이 계약과 일치하지 않습니다.',
      undefined,
      'RECORDED_PLAYBACK_CONTRACT_INVALID',
    )
  }
  return {
    lessonId: data.lessonId,
    recordedVideoId: data.recordedVideoId,
    durationMs: data.durationMs,
    source: {
      url: sourceUrl,
      availableFromMs: data.source.availableFromMs,
      availableToMs: data.source.availableToMs,
    },
  }
}

export const httpRecordedLessonService = {
  async getProcessing(lessonId) {
    const { data } = await apiClient.get<RecordedProcessingView>(
      `/instructor/recorded-lessons/${lessonId}/processing`,
    )
    return normalizeProcessing(data, lessonId)
  },
  async retryProcessing(lessonId) {
    const { data } = await apiClient.post<RecordedProcessingView>(
      `/instructor/recorded-lessons/${lessonId}/processing/retry`,
    )
    return normalizeProcessing(data, lessonId)
  },
  async getPlayback(lessonId) {
    const { data } = await apiClient.get<RecordedPlaybackView>(
      `/lessons/${lessonId}/recorded-playback`,
    )
    return normalizePlayback(data, lessonId)
  },
} satisfies RecordedLessonService
