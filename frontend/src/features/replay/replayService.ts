import { selectDataSource } from '@/shared/api/dataSource'
import { httpReplayService } from './httpReplayService'
import { mockReplayService } from './mockReplayService'
import type { ReplayService } from './replayService.interface'

const replayService = selectDataSource<ReplayService>(mockReplayService, httpReplayService)

export const getReplayCaptions = (lessonId: string) => replayService.getReplayCaptions(lessonId)
export const getReplayMessages = (lessonId: string) => replayService.getReplayMessages(lessonId)
export const askReplayAi = (lessonId: string, question: string, sessionMs: number) => replayService.askReplayAi(lessonId, question, sessionMs)
export const saveReplayReview = (lessonId: string, transcript: string) => replayService.saveReplayReview(lessonId, transcript)
export const publishReplayReview = (lessonId: string, transcript: string) => replayService.publishReplayReview(lessonId, transcript)
export const submitReplayQuiz = (lessonId: string, answer: string) => replayService.submitReplayQuiz(lessonId, answer)

export type { ReplayService } from './replayService.interface'
