import { notImplemented } from '@/shared/api/notImplemented'
import type { ReplayService } from './replayService.interface'

/**
 * 다시보기 HTTP 어댑터.
 *
 * 이 화면이 쓰는 경로는 아직 서버에 하나도 없다 — 게시본 자막·채팅(CONTRACT §2 자막/용어),
 * AI 질의(§2 AI), 퀴즈(§2 퀴즈), 강사 검수는 모두 CP3~CP5 범위다. 경로만 적어 두고 호출하면
 * 404가 나는데 화면에서는 그게 서버 장애와 구분되지 않으므로 미구현임을 명시한다.
 * 서버가 생기는 순서대로 한 줄씩 실제 호출로 바꾼다.
 */
export const httpReplayService = {
  async getReplayCaptions(lessonId) {
    return notImplemented(`GET /lessons/${lessonId}/captions`)
  },
  async getReplayMessages(lessonId) {
    return notImplemented(`GET /lessons/${lessonId}/messages`)
  },
  async askReplayAi(lessonId) {
    return notImplemented(`POST /lessons/${lessonId}/ai/questions:stream`)
  },
  async saveReplayReview(lessonId) {
    return notImplemented(`PUT /instructor/lessons/${lessonId}/replay-review`)
  },
  async publishReplayReview(lessonId) {
    return notImplemented(`POST /instructor/lessons/${lessonId}/replay-review/publish`)
  },
  async submitReplayQuiz(lessonId) {
    return notImplemented(`POST /lessons/${lessonId}/quizzes/answers`)
  },
} satisfies ReplayService
