import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type { ReplayService } from './replayService.interface'

/**
 * 다시보기 HTTP 어댑터.
 *
 * 영상 게시 API는 CP4에서 구현됐고, 게시본 자막·채팅·AI·퀴즈·검수 저장은 CP3~CP5 범위라
 * 아직 명시적인 미구현 오류를 유지한다.
 */
export const httpReplayService = {
  async askReplayAi(lessonId) {
    return notImplemented(`POST /lessons/${lessonId}/ai/questions:stream`)
  },
  async saveReplayReview(lessonId) {
    return notImplemented(`PUT /instructor/lessons/${lessonId}/replay-review`)
  },
  async publishReplayReview(lessonId) {
    await apiClient.post(`/instructor/lessons/${lessonId}/replay-review/publish`)
  },
  async submitReplayQuiz(lessonId) {
    return notImplemented(`POST /lessons/${lessonId}/quizzes/answers`)
  },
} satisfies ReplayService
