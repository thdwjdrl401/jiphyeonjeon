import { selectDataSource } from '@/shared/api/dataSource'
import { httpRecordedLessonService } from './httpRecordedLessonService'
import { mockRecordedLessonService } from './mockRecordedLessonService'
import type { RecordedLessonService } from './recordedLessonService.interface'

const recordedLessonService = selectDataSource<RecordedLessonService>(
  mockRecordedLessonService,
  httpRecordedLessonService,
)

export const getRecordedProcessing = (lessonId: string) =>
  recordedLessonService.getProcessing(lessonId)
export const uploadRecordedVideo = (lessonId: string, file: File) =>
  recordedLessonService.uploadRecordedVideo(lessonId, file)
export const retryRecordedProcessing = (lessonId: string) =>
  recordedLessonService.retryProcessing(lessonId)
export const retryRecordedCaptions = (lessonId: string) =>
  recordedLessonService.retryCaptions(lessonId)
export const getRecordedPlayback = (lessonId: string) =>
  recordedLessonService.getPlayback(lessonId)
export const getRecordedCaptionSegments = (lessonId: string) =>
  recordedLessonService.getCaptionSegments(lessonId)
export const askRecordedAi = (
  lessonId: string,
  question: string,
  playbackMs: number,
  options: Parameters<RecordedLessonService['askAi']>[3],
) => recordedLessonService.askAi(lessonId, question, playbackMs, options)

export type {
  RecordedLessonService,
  RecordedPlaybackView,
  RecordedProcessingStatus,
  RecordedCaptionStatus,
  RecordedPublicationStatus,
  RecordedProcessingView,
  RecordedCaptionSegmentView,
} from './recordedLessonService.interface'
