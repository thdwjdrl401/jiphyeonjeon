import type { AiAnswerStreamOptions } from '@/features/live-session/liveSessionService.interface'

export type RecordedProcessingStatus =
  | 'AWAITING_UPLOAD'
  | 'QUEUED'
  | 'TRANSCODING'
  | 'VERIFYING'
  | 'READY'
  | 'FAILED'

export type RecordedCaptionStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'PROCESSING'
  | 'READY'
  | 'EMPTY'
  | 'FAILED'

export type RecordedPublicationStatus = 'DRAFT' | 'PUBLISHED'

export interface RecordedProcessingView {
  lessonId: string
  recordedVideoId: string
  jobId: string | null
  status: RecordedProcessingStatus
  failureCode: string | null
  durationMs: number | null
  sizeBytes: number | null
  readyAt: string | null
  captionStatus: RecordedCaptionStatus
  captionFailureCode: string | null
  captionProcessedChunks: number
  captionTotalChunks: number | null
  captionReadyAt: string | null
  recordedPublicationStatus: RecordedPublicationStatus
  publishedAt: string | null
}

export interface RecordedCaptionTrackView {
  trackId: string
  language: string
  label: string
  kind: 'subtitles'
  format: 'WEBVTT'
  url: string
  version: number
  default: boolean
}

export interface RecordedPlaybackView {
  lessonId: string
  recordedVideoId: string
  durationMs: number
  recordedPublicationStatus: 'PUBLISHED'
  source: {
    url: string
    availableFromMs: number
    availableToMs: number
  }
  captions: {
    status: 'AVAILABLE' | 'EMPTY'
    tracks: RecordedCaptionTrackView[]
  }
}

export interface RecordedCaptionSegmentView {
  segmentId: number
  startMs: number
  endMs: number
  text: string
}

export interface RecordedLessonService {
  getProcessing: (lessonId: string) => Promise<RecordedProcessingView>
  retryProcessing: (lessonId: string) => Promise<RecordedProcessingView>
  retryCaptions: (lessonId: string) => Promise<RecordedProcessingView>
  getPlayback: (lessonId: string) => Promise<RecordedPlaybackView>
  getCaptionSegments: (lessonId: string) => Promise<RecordedCaptionSegmentView[]>
  askAi: (
    lessonId: string,
    question: string,
    playbackMs: number,
    options: AiAnswerStreamOptions,
  ) => Promise<void>
}
