import { selectDataSource } from '@/shared/api/dataSource'
import { httpLearningService } from './httpLearningService'
import { mockLearningService } from './mockLearningService'
import type { LearningService } from './learningService.interface'

const learningService = selectDataSource<LearningService>(mockLearningService, httpLearningService)

export const getLearningContext = (lessonId: string) => learningService.getLearningContext(lessonId)
