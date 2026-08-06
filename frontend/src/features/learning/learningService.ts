import { selectDataSource } from '@/shared/api/dataSource'
import { httpLearningService } from './httpLearningService'
import { mockLearningService } from './mockLearningService'
import type { LearningService, ProgressUpdate } from './learningService.interface'

const learningService = selectDataSource<LearningService>(mockLearningService, httpLearningService)

export const getLearningContext = (lessonId: string) => learningService.getLearningContext(lessonId)

export const updateProgress = (lessonId: string, update: ProgressUpdate) =>
  learningService.updateProgress(lessonId, update)

export const deleteBookmark = (lessonId: string, bookmarkId: string) =>
  learningService.deleteBookmark(lessonId, bookmarkId)
