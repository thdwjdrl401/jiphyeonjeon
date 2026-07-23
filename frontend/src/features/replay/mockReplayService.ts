import { demoCaptions, demoMessages } from '@/features/demo/demoData'
import type { ReplayService } from './replayService.interface'

const replayReviews = new Map<string, { transcript: string; published: boolean }>()

export const mockReplayService = {
  async getReplayCaptions() {
    return demoCaptions
  },
  async getReplayMessages() {
    return demoMessages
  },
  async askReplayAi() {
    return { answer: '세션은 인증 상태를 여러 요청에 걸쳐 유지하고, SecurityContext는 현재 요청에서 인증 주체를 참조하는 역할을 합니다.' }
  },
  async saveReplayReview(lessonId, transcript) {
    replayReviews.set(lessonId, { transcript, published: false })
  },
  async publishReplayReview(lessonId, transcript) {
    replayReviews.set(lessonId, { transcript, published: true })
  },
  async submitReplayQuiz(_lessonId, answer) {
    return { correct: answer === 'SecurityContext' }
  },
} satisfies ReplayService
