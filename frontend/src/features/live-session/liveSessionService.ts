import { selectDataSource } from '@/shared/api/dataSource'
import { httpLiveSessionService } from './httpLiveSessionService'
import { mockLiveSessionService } from './mockLiveSessionService'
import type { LiveSessionService } from './liveSessionService.interface'

const liveSessionService = selectDataSource<LiveSessionService>(mockLiveSessionService, httpLiveSessionService)

export const getLiveSession = (sessionId: string) => liveSessionService.getLiveSession(sessionId)
export const getPreflightChecks = (sessionId: string) => liveSessionService.getPreflightChecks(sessionId)
export const startLiveSession = (sessionId: string) => liveSessionService.startLiveSession(sessionId)
export const endLiveSession = (sessionId: string) => liveSessionService.endLiveSession(sessionId)
export const getLiveToken = (sessionId: string) => liveSessionService.getLiveToken(sessionId)
export const getParticipants = (sessionId: string) => liveSessionService.getParticipants(sessionId)
export const getChatMessages = (sessionId: string) => liveSessionService.getChatMessages(sessionId)
export const sendChatMessage = (sessionId: string, text: string, question: boolean) => liveSessionService.sendChatMessage(sessionId, text, question)
export const getCaptions = (sessionId: string) => liveSessionService.getCaptions(sessionId)
export const askLiveAi = (lessonId: string, question: string) => liveSessionService.askLiveAi(lessonId, question)
export const saveBookmark = (lessonId: string, sessionMs: number) => liveSessionService.saveBookmark(lessonId, sessionMs)
export const getProcessingStatus = (sessionId: string) => liveSessionService.getProcessingStatus(sessionId)
export const getQuestionHighlights = (sessionId: string) => liveSessionService.getQuestionHighlights(sessionId)

export type {
  CaptionView,
  ChatMessageView,
  LiveSessionService,
  LiveSessionView,
  PreflightCheck,
  ProcessingStatus,
  QuestionHighlight,
} from './liveSessionService.interface'
