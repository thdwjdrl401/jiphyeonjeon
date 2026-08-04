import { selectDataSource } from '@/shared/api/dataSource'
import { httpReplayService } from './httpReplayService'
import { mockReplayService } from './mockReplayService'
import type { ReplayService } from './replayService.interface'

const replayService = selectDataSource<ReplayService>(mockReplayService, httpReplayService)

export const saveReplayReview = (lessonId: string, transcript: string) => replayService.saveReplayReview(lessonId, transcript)
export const publishReplayReview = (lessonId: string) => replayService.publishReplayReview(lessonId)
export const submitReplayQuiz = (lessonId: string, answer: string) => replayService.submitReplayQuiz(lessonId, answer)

export type { ReplayService } from './replayService.interface'
