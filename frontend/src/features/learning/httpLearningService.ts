import { apiClient } from '@/shared/api/client'
import type { LearningContext, LearningService } from './learningService.interface'

export const httpLearningService = {
  async getLearningContext(lessonId) {
    const { data } = await apiClient.get<LearningContext>(`/lessons/${lessonId}/learning-context`)
    return data
  },
} satisfies LearningService
