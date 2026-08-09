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
  /**
   * 이미 만들어진 녹화강의에 <b>원본 영상을 올린다</b>. 상태가 `AWAITING_UPLOAD`일 때만 열린다.
   *
   * <p>업로드가 끊기면 강의는 만들어진 채 영상만 없는 상태로 남는데, 예전에는 그 강의에 영상을
   * 붙일 길이 화면에 없었다 — 지우고 처음부터 다시 하는 수밖에 없었다. 서버는 처음부터 이 경로를
   * 열어 두고 있었다(`issueUpload`가 AWAITING_UPLOAD에서 이전 에셋을 버리고 새로 발급한다).
   */
  uploadRecordedVideo: (lessonId: string, file: File) => Promise<RecordedProcessingView>
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
