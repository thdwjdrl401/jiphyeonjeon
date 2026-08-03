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
export const retryRecordedProcessing = (lessonId: string) =>
  recordedLessonService.retryProcessing(lessonId)
export const getRecordedPlayback = (lessonId: string) =>
  recordedLessonService.getPlayback(lessonId)

export type {
  RecordedLessonService,
  RecordedPlaybackView,
  RecordedProcessingStatus,
  RecordedProcessingView,
} from './recordedLessonService.interface'
