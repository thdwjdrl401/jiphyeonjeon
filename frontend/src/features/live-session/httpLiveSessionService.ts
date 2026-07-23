import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import { apiClient } from '@/shared/api/client'
import { normalizeCaption, type ApiCaptionView } from './captionAdapter'
import type {
  ChatMessageView,
  LiveSessionService,
  LiveSessionView,
  PreflightCheck,
  ProcessingStatus,
  QuestionHighlight,
} from './liveSessionService.interface'

interface ApiLiveSessionView {
  sessionId: string
  lessonId: string
  liveSessionStatus: string
  scheduledAt: string | null
  entryWindowMinutes: number | null
  expectedDurationMinutes: number | null
}

interface ApiChatMessage {
  messageId: string
  alias: string
  text: string
  createdAt?: string
  isQuestion: boolean
}

interface ApiLiveToken {
  livekitUrl: string
  accessToken: string
}

interface ApiParticipant {
  identity: string
  name: string
  state: string
  joinedAtEpochSeconds: number
}

function normalizeMessage(message: ApiChatMessage): ChatMessageView {
  return {
    id: message.messageId,
    alias: message.alias,
    text: message.text,
    time: message.createdAt ? new Date(message.createdAt).toLocaleTimeString('ko-KR') : '-',
    question: message.isQuestion,
  }
}

export const httpLiveSessionService = {
  async getLiveSession(sessionId) {
    const { data } = await apiClient.get<ApiLiveSessionView>(`/live-sessions/${sessionId}`)
    const entryWindowMinutes = data.entryWindowMinutes ?? 10
    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null
    return {
      sessionId: data.sessionId,
      lessonId: data.lessonId,
      lessonTitle: '',
      curriculumId: '',
      curriculumTitle: '',
      sectionId: '',
      status: data.liveSessionStatus as CurriculumLiveSessionStatus,
      scheduledAt: data.scheduledAt,
      entryOpensAt: scheduledAt
        ? new Date(scheduledAt.getTime() - entryWindowMinutes * 60_000).toISOString()
        : null,
      entryWindowMinutes,
      expectedDurationMinutes: data.expectedDurationMinutes ?? 0,
      participants: 0,
    } satisfies LiveSessionView
  },
  async getPreflightChecks(sessionId) {
    const { data } = await apiClient.post<PreflightCheck[]>(`/instructor/live-sessions/${sessionId}/preflight`)
    return data
  },
  async startLiveSession(sessionId) {
    await apiClient.post(`/live-sessions/${sessionId}/start`)
  },
  async endLiveSession(sessionId) {
    await apiClient.post(`/live-sessions/${sessionId}/end`)
  },
  async getLiveToken(sessionId) {
    const { data } = await apiClient.post<ApiLiveToken>(`/live-sessions/${sessionId}/token`)
    return { token: data.accessToken, wsUrl: data.livekitUrl }
  },
  async getParticipants(sessionId) {
    const { data } = await apiClient.get<ApiParticipant[]>(`/instructor/live-sessions/${sessionId}/participants`)
    return data.map((participant) => ({
      alias: participant.name || participant.identity,
      state: participant.state,
      joinedAt: new Date(participant.joinedAtEpochSeconds * 1000).toLocaleTimeString('ko-KR'),
    }))
  },
  async getChatMessages(sessionId) {
    const { data } = await apiClient.get<ApiChatMessage[]>(`/live-sessions/${sessionId}/messages`)
    return data.map(normalizeMessage)
  },
  async sendChatMessage(sessionId, text, question) {
    const { data } = await apiClient.post<ApiChatMessage>(`/live-sessions/${sessionId}/messages`, {
      clientMessageId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      text,
      isQuestion: question,
      viewingSessionMs: null,
    })
    const message = normalizeMessage(data)
    return { ...message, time: data.createdAt ? message.time : '현재' }
  },
  async getCaptions(sessionId) {
    const { data } = await apiClient.get<ApiCaptionView[]>(`/live-sessions/${sessionId}/captions`)
    return data.map(normalizeCaption)
  },
  async askLiveAi(lessonId, question) {
    const { data } = await apiClient.post<{ answer: string }>(`/lessons/${lessonId}/ai/questions:stream`, { question })
    return data
  },
  async saveBookmark(lessonId, sessionMs) {
    await apiClient.post(`/lessons/${lessonId}/bookmarks`, { sessionMs })
  },
  async getProcessingStatus(sessionId) {
    const { data } = await apiClient.get<ProcessingStatus>(`/instructor/live-sessions/${sessionId}/processing`)
    return data
  },
  async getQuestionHighlights(sessionId) {
    const { data } = await apiClient.get<QuestionHighlight[]>(`/instructor/live-sessions/${sessionId}/question-highlights`)
    return data
  },
} satisfies LiveSessionService
