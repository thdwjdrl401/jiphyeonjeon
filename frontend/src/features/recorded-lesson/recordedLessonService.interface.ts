export type RecordedProcessingStatus =
  | 'AWAITING_UPLOAD'
  | 'QUEUED'
  | 'TRANSCODING'
  | 'VERIFYING'
  | 'READY'
  | 'FAILED'

export interface RecordedProcessingView {
  lessonId: string
  recordedVideoId: string
  jobId: string | null
  status: RecordedProcessingStatus
  failureCode: string | null
  durationMs: number | null
  sizeBytes: number | null
  readyAt: string | null
}

export interface RecordedPlaybackView {
  lessonId: string
  recordedVideoId: string
  durationMs: number
  source: {
    url: string
    availableFromMs: number
    availableToMs: number
  }
}

export interface RecordedLessonService {
  getProcessing: (lessonId: string) => Promise<RecordedProcessingView>
  retryProcessing: (lessonId: string) => Promise<RecordedProcessingView>
  getPlayback: (lessonId: string) => Promise<RecordedPlaybackView>
}
