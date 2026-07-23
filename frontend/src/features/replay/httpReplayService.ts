import type { CaptionView, ChatMessageView } from '@/features/live-session/liveSessionService.interface'
import { apiClient } from '@/shared/api/client'
import type { ReplayService } from './replayService.interface'

export const httpReplayService = {
  async getReplayCaptions(lessonId) {
    const { data } = await apiClient.get<CaptionView[]>(`/lessons/${lessonId}/captions`)
    return data
  },
  async getReplayMessages(lessonId) {
    const { data } = await apiClient.get<ChatMessageView[]>(`/lessons/${lessonId}/messages`)
    return data
  },
  async askReplayAi(lessonId, question, sessionMs) {
    const { data } = await apiClient.post<{ answer: string }>(`/lessons/${lessonId}/ai/questions:stream`, {
      question,
      sessionMs,
    })
    return data
  },
  async saveReplayReview(lessonId, transcript) {
    await apiClient.put(`/instructor/lessons/${lessonId}/replay-review`, { transcript })
  },
  async publishReplayReview(lessonId, transcript) {
    await apiClient.post(`/instructor/lessons/${lessonId}/replay-review/publish`, { transcript })
  },
  async submitReplayQuiz(lessonId, answer) {
    const { data } = await apiClient.post<{ correct: boolean }>(`/lessons/${lessonId}/quizzes/answers`, { answer })
    return data
  },
} satisfies ReplayService
