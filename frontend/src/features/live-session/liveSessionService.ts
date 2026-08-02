import { selectDataSource } from '@/shared/api/dataSource'
import { httpLiveSessionService } from './httpLiveSessionService'
import { mockLiveSessionService } from './mockLiveSessionService'
import type { LiveSessionService } from './liveSessionService.interface'

const liveSessionService = selectDataSource<LiveSessionService>(mockLiveSessionService, httpLiveSessionService)

export const getLiveSession = (sessionId: string) => liveSessionService.getLiveSession(sessionId)
export const getPlayback = (lessonId: string) => liveSessionService.getPlayback(lessonId)

/**
 * 세션이 아직 진행 중인가(CONTRACT §2 다시보기).
 *
 * 플레이어 UI(LIVE 배지)와 재생 metadata 폴링 주기가 이 판정으로 갈린다. 플레이어 모듈이 아니라
 * 여기 두는 이유는 계약 필드 위의 판정이기 때문이고, 덕분에 플레이어를 목으로 갈아끼운 테스트에서도
 * 그대로 동작한다.
 */
const LIVE_SESSION_STATUSES = ['STARTING', 'LIVE', 'ENDING']

export const isLiveStatus = (liveSessionStatus: string) =>
  LIVE_SESSION_STATUSES.includes(liveSessionStatus)
export const preparePreflightRoom = (sessionId: string) => liveSessionService.preparePreflightRoom(sessionId)
export const getPreflightReadiness = (sessionId: string) => liveSessionService.getPreflightReadiness(sessionId)
export const startLiveSession = (sessionId: string) => liveSessionService.startLiveSession(sessionId)
export const getLiveStartStatus = (sessionId: string, operationId?: string) =>
  liveSessionService.getLiveStartStatus(sessionId, operationId)
export const endLiveSession = (sessionId: string) => liveSessionService.endLiveSession(sessionId)
export const getInstructorLiveToken = (sessionId: string) =>
  liveSessionService.getInstructorLiveToken(sessionId)
export const getParticipants = (sessionId: string) => liveSessionService.getParticipants(sessionId)
export const getChatMessages = (sessionId: string) => liveSessionService.getChatMessages(sessionId)
export const sendChatMessage = (
  sessionId: string,
  input: Parameters<LiveSessionService['sendChatMessage']>[1],
) => liveSessionService.sendChatMessage(sessionId, input)
export const subscribeChatMessages = (
  sessionId: string,
  onMessage: Parameters<LiveSessionService['subscribeChatMessages']>[1],
  onConnectionChange: Parameters<LiveSessionService['subscribeChatMessages']>[2],
) => liveSessionService.subscribeChatMessages(sessionId, onMessage, onConnectionChange)
export const subscribeSessionState = (
  sessionId: string,
  onEvent: Parameters<LiveSessionService['subscribeSessionState']>[1],
  onConnectionChange: Parameters<LiveSessionService['subscribeSessionState']>[2],
) => liveSessionService.subscribeSessionState(sessionId, onEvent, onConnectionChange)
export const getCaptions = (sessionId: string) => liveSessionService.getCaptions(sessionId)
export const subscribeCaptions = (
  sessionId: string,
  onEvent: Parameters<LiveSessionService['subscribeCaptions']>[1],
  onConnectionChange: Parameters<LiveSessionService['subscribeCaptions']>[2],
) => liveSessionService.subscribeCaptions(sessionId, onEvent, onConnectionChange)
export const askLiveAi = (
  sessionId: string,
  question: string,
  options: Parameters<LiveSessionService['askLiveAi']>[2],
) => liveSessionService.askLiveAi(sessionId, question, options)
export const saveBookmark = (lessonId: string, sessionMs: number) => liveSessionService.saveBookmark(lessonId, sessionMs)
export const getProcessingStatus = (sessionId: string) => liveSessionService.getProcessingStatus(sessionId)
export const getQuestionHighlights = (sessionId: string) => liveSessionService.getQuestionHighlights(sessionId)

export type {
  AiAnswerSource,
  AiAnswerStreamEvent,
  AiAnswerStreamOptions,
  CaptionView,
  CaptionDeltaPayload,
  CaptionStreamCompletedPayload,
  CaptionStreamEvent,
  ChatConnectionState,
  ChatMessageView,
  LectureNoteTopic,
  LectureNoteView,
  LiveSessionService,
  LiveSessionStateEvent,
  LiveSessionView,
  PlaybackSourceView,
  PlaybackView,
  LiveStartOperation,
  LiveStartStatus,
  PreflightReadiness,
  PreflightRoom,
  ProcessingStatus,
  QuestionHighlight,
  SendChatMessageInput,
} from './liveSessionService.interface'

export const getLectureNotes = (sessionId: string) => liveSessionService.getLectureNotes(sessionId)

export const subscribeLectureNotes = (
  sessionId: string,
  onNote: Parameters<LiveSessionService['subscribeLectureNotes']>[1],
  onConnectionChange: Parameters<LiveSessionService['subscribeLectureNotes']>[2],
) => liveSessionService.subscribeLectureNotes(sessionId, onNote, onConnectionChange)
