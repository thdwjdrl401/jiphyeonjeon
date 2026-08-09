import axios from 'axios'
import { streamLessonAiAnswer } from '@/features/ai/lessonAiAnswerStream'
import { ApiError, apiClient } from '@/shared/api/client'
interface RecordedUploadTicket {
  assetId: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
}

import type {
  RecordedCaptionSegmentView,
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

function normalizeCaptionSegments(data: RecordedCaptionSegmentView[]): RecordedCaptionSegmentView[] {
  if (!Array.isArray(data) || data.some((segment) => (
    !Number.isFinite(segment.segmentId)
    || !Number.isFinite(segment.startMs)
    || !Number.isFinite(segment.endMs)
    || segment.startMs < 0
    || segment.endMs < segment.startMs
    || typeof segment.text !== 'string'
  ))) {
    throw new ApiError(
      '녹화강의 자막 응답이 계약과 일치하지 않습니다.',
      undefined,
      'RECORDED_CAPTION_CONTRACT_INVALID',
    )
  }
  return data.map((segment) => ({ ...segment, text: segment.text.trim() }))
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
  /** 티켓 발급 → 스토리지 직접 PUT → 접수. 업로드 화면의 ③④와 같은 경로다. */
  async uploadRecordedVideo(lessonId, file) {
    const { data: ticket } = await apiClient.post<RecordedUploadTicket>(
      `/instructor/recorded-lessons/${lessonId}/video/upload-requests`,
      { fileName: file.name, contentType: file.type || 'video/mp4', fileSize: file.size },
    )
    // 대용량 MP4는 앱 API·세션 쿠키·CSRF 인터셉터를 거치지 않고 스토리지에 직접 PUT한다.
    await axios.request({ url: ticket.uploadUrl, method: ticket.method, headers: ticket.headers, data: file })
    const { data } = await apiClient.post<RecordedProcessingView>(
      `/instructor/recorded-lessons/${lessonId}/video/complete`,
      { assetId: ticket.assetId },
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
  async getCaptionSegments(lessonId) {
    const { data } = await apiClient.get<RecordedCaptionSegmentView[]>(
      `/lessons/${lessonId}/recorded-playback/captions`,
    )
    return normalizeCaptionSegments(data)
  },
  // 라이브 다시보기와 같은 endpoint·같은 리더를 쓴다(ADR-0075). 예전에는 이 파일에 SSE 리더가
  // 통째로 복사돼 있었다.
  async askAi(lessonId, question, playbackMs, options) {
    await streamLessonAiAnswer(lessonId, question, playbackMs, options)
  },
} satisfies RecordedLessonService
