import { ApiError, apiClient } from '@/shared/api/client'
import type {
  RecordedLessonService,
  RecordedCaptionStatus,
  RecordedPublicationStatus,
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
const CAPTION_STATUSES = new Set<RecordedCaptionStatus>([
  'NOT_REQUESTED', 'PENDING', 'PROCESSING', 'READY', 'EMPTY', 'FAILED',
])
const PUBLICATION_STATUSES = new Set<RecordedPublicationStatus>(['DRAFT', 'PUBLISHED'])

function nullableNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value
}

function normalizeProcessing(data: RecordedProcessingView, lessonId: string): RecordedProcessingView {
  if (
    data.lessonId !== lessonId
    || !data.recordedVideoId
    || !PROCESSING_STATUSES.has(data.status)
    || !CAPTION_STATUSES.has(data.captionStatus)
    || !PUBLICATION_STATUSES.has(data.recordedPublicationStatus)
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
    captionStatus: data.captionStatus,
    captionFailureCode: data.captionFailureCode ?? null,
    captionProcessedChunks: nullableNumber(data.captionProcessedChunks) ?? 0,
    captionTotalChunks: nullableNumber(data.captionTotalChunks),
    captionReadyAt: data.captionReadyAt ?? null,
    recordedPublicationStatus: data.recordedPublicationStatus,
    publishedAt: data.publishedAt ?? null,
  }
}

function normalizePlayback(data: RecordedPlaybackView, lessonId: string): RecordedPlaybackView {
  const sourceUrl = data.source?.url?.trim()
  if (
    data.lessonId !== lessonId
    || !data.recordedVideoId
    || data.recordedPublicationStatus !== 'PUBLISHED'
    || !Number.isFinite(data.durationMs)
    || data.durationMs <= 0
    || !sourceUrl
    || !Number.isFinite(data.source.availableFromMs)
    || !Number.isFinite(data.source.availableToMs)
    || !data.captions
    || !['AVAILABLE', 'EMPTY'].includes(data.captions.status)
    || !Array.isArray(data.captions.tracks)
    || (data.captions.status === 'AVAILABLE' && data.captions.tracks.length === 0)
    || (data.captions.status === 'EMPTY' && data.captions.tracks.length !== 0)
    || data.captions.tracks.some((track) => (
      !track.trackId
      || !track.language?.trim()
      || !track.label?.trim()
      || !track.url?.trim()
      || track.kind !== 'subtitles'
      || track.format !== 'WEBVTT'
      || !Number.isFinite(track.version)
    ))
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
    recordedPublicationStatus: 'PUBLISHED',
    source: {
      url: sourceUrl,
      availableFromMs: data.source.availableFromMs,
      availableToMs: data.source.availableToMs,
    },
    captions: {
      status: data.captions.status,
      tracks: data.captions.tracks.map((track) => ({
        ...track,
        language: track.language.trim(),
        label: track.label.trim(),
        url: track.url.trim(),
      })),
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
  async retryCaptions(lessonId) {
    const { data } = await apiClient.post<RecordedProcessingView>(
      `/instructor/recorded-lessons/${lessonId}/captions/retry`,
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
