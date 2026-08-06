import { apiClient } from '@/shared/api/client'
import type { LearningContext, LearningService } from './learningService.interface'

export const httpLearningService = {
  async getLearningContext(lessonId) {
    const { data } = await apiClient.get<LearningContext>(`/lessons/${lessonId}/learning-context`)
    return data
  },
  async updateProgress(lessonId, update) {
    await apiClient.put(`/lessons/${lessonId}/progress`, update)
  },
  async deleteBookmark(lessonId, bookmarkId) {
    await apiClient.delete(`/lessons/${lessonId}/bookmarks/${bookmarkId}`)
  },
} satisfies LearningService
