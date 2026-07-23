import type { CaptionView, ChatMessageView } from '@/features/live-session/liveSessionService.interface'

export interface ReplayService {
  getReplayCaptions: (lessonId: string) => Promise<CaptionView[]>
  getReplayMessages: (lessonId: string) => Promise<ChatMessageView[]>
  askReplayAi: (lessonId: string, question: string, sessionMs: number) => Promise<{ answer: string }>
  saveReplayReview: (lessonId: string, transcript: string) => Promise<void>
  publishReplayReview: (lessonId: string, transcript: string) => Promise<void>
  submitReplayQuiz: (lessonId: string, answer: string) => Promise<{ correct: boolean }>
}
