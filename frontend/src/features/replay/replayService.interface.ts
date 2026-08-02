import type { CaptionView, ChatMessageView } from '@/features/live-session/liveSessionService.interface'

export interface ReplayService {
  getReplayCaptions: (lessonId: string) => Promise<CaptionView[]>
  getReplayMessages: (lessonId: string) => Promise<ChatMessageView[]>
  askReplayAi: (lessonId: string, question: string, sessionMs: number) => Promise<{ answer: string }>
  saveReplayReview: (lessonId: string, transcript: string) => Promise<void>
  /** 영상 다시보기 공개. 자막 검수 초안은 이 요청에 포함하지 않는다. */
  publishReplayReview: (lessonId: string) => Promise<void>
  submitReplayQuiz: (lessonId: string, answer: string) => Promise<{ correct: boolean }>
}
