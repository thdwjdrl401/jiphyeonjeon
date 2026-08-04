import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type { ReplayService } from './replayService.interface'

/**
 * 다시보기 HTTP 어댑터.
 *
 * 영상 게시 API는 CP4에서, 다시보기 AI 질문은 ADR-0075로 구현됐다(후자는 liveSessionService 소유).
 * 검수 저장·퀴즈는 아직 서버 경로가 없어 명시적인 미구현 오류를 유지한다.
 */
export const httpReplayService = {
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
