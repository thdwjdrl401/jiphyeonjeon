import type { AiAnswerSource, AiAnswerStreamEvent } from '@/features/live-session/liveSessionService.interface'
import {
  ApiError,
  apiClient,
  invalidateCsrfToken,
  resolveCsrfHeader,
  type FieldError,
} from '@/shared/api/client'
import { createSseDecoder, type SseFrame } from '@/shared/api/sse'
import { isNetworkBlocked } from '@/shared/config/runtime'
import type {
  RecordedCaptionSegmentView,
  RecordedLessonService,
  RecordedCaptionStatus,
  RecordedPublicationStatus,
  RecordedPlaybackView,
  RecordedProcessingStatus,
  RecordedProcessingView,
} from './recordedLessonService.interface'

interface ApiErrorEnvelope {
  code?: string
  message?: string
  fieldErrors?: FieldError[]
  correlationId?: string
}

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

const AI_ANSWER_EVENT_TYPES = new Set(['answer.delta', 'answer.done', 'answer.insufficient', 'answer.error'])

function readExcerpt(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text.length > 0 ? text : undefined
}

/** Replay v2의 session-ms 근거를 기존 AI 카드 모델의 startMs/endMs로 옮긴다. */
function normalizeReplaySources(raw: unknown): AiAnswerSource[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): AiAnswerSource[] => {
    const source = item as Record<string, unknown>
    if (source?.type === 'PPTX') {
      return [{
        type: 'PPTX',
        materialId: String(source.materialId ?? ''),
        page: Number(source.page ?? 0),
        excerpt: readExcerpt(source.excerpt),
      }]
    }
    if (source?.type === 'CAPTION') {
      const sessionId = String(source.sessionId ?? '')
      return [{
        type: 'CAPTION',
        sessionId,
        sttSessionId: `recorded:${sessionId}`,
        startMs: Number(source.startSessionMs ?? 0),
        endMs: Number(source.endSessionMs ?? 0),
        excerpt: readExcerpt(source.excerpt),
        timeAxis: 'PLAYBACK',
      }]
    }
    return []
  })
}

function toReplayAiEvent(frame: SseFrame): AiAnswerStreamEvent | null {
  if (!AI_ANSWER_EVENT_TYPES.has(frame.event)) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(frame.data) as Record<string, unknown>
  } catch {
    return null
  }
  const requestId = String(payload.requestId ?? '')
  switch (frame.event) {
    case 'answer.delta':
      return { type: 'answer.delta', payload: { requestId, text: String(payload.text ?? '') } }
    case 'answer.done':
      return { type: 'answer.done', payload: { requestId, sources: normalizeReplaySources(payload.sources) } }
    case 'answer.insufficient':
      return { type: 'answer.insufficient', payload: { requestId, message: String(payload.message ?? '') } }
    default:
      return {
        type: 'answer.error',
        payload: {
          requestId,
          code: String(payload.code ?? ''),
          message: String(payload.message ?? ''),
          retryable: payload.retryable === true,
        },
      }
  }
}

function isAbort(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

async function toStreamStartError(response: Response) {
  let payload: ApiErrorEnvelope = {}
  try {
    payload = (await response.json()) as ApiErrorEnvelope
  } catch {
    // 게이트웨이 오류처럼 JSON 봉투가 없을 수 있다.
  }
  if (response.status === 401) invalidateCsrfToken()
  return new ApiError(
    payload.message ?? '요청을 처리하지 못했습니다.',
    response.status,
    payload.code,
    payload.fieldErrors,
    payload.correlationId,
  )
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
  async getCaptionSegments(lessonId) {
    const { data } = await apiClient.get<RecordedCaptionSegmentView[]>(
      `/lessons/${lessonId}/recorded-playback/captions`,
    )
    return normalizeCaptionSegments(data)
  },
  async askAi(lessonId, question, playbackMs, { onEvent, signal }) {
    if (isNetworkBlocked) {
      throw new ApiError(
        '테스트에서는 실제 네트워크 요청을 보낼 수 없습니다.',
        undefined,
        'MOCK_API_NETWORK_REQUEST_BLOCKED',
      )
    }
    let response: Response
    try {
      response = await fetch(`/api/lessons/${lessonId}/ai/answers/stream`, {
        method: 'POST',
        credentials: 'include',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(await resolveCsrfHeader()),
        },
        body: JSON.stringify({ question, playbackMs }),
      })
    } catch (error) {
      if (isAbort(error, signal)) return
      throw new ApiError('AI 답변 요청을 보내지 못했습니다.', undefined, 'AI_ANSWER_NETWORK_FAILED')
    }
    if (!response.ok) throw await toStreamStartError(response)
    if (!response.body) {
      throw new ApiError('AI 답변 스트림을 읽을 수 없습니다.', response.status, 'AI_ANSWER_STREAM_UNREADABLE')
    }

    const decoder = createSseDecoder()
    const text = new TextDecoder()
    const reader = response.body.getReader()
    const emit = (frames: SseFrame[]) => {
      for (const frame of frames) {
        const event = toReplayAiEvent(frame)
        if (event) onEvent(event)
      }
    }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        emit(decoder.push(text.decode(value, { stream: true })))
      }
      emit(decoder.flush())
    } catch (error) {
      if (isAbort(error, signal)) return
      throw new ApiError('AI 답변 스트림이 끊겼습니다.', undefined, 'AI_ANSWER_STREAM_FAILED')
    } finally {
      void reader.cancel().catch(() => undefined)
    }
  },
} satisfies RecordedLessonService
