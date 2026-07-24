import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import { apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type {
  ChatMessageView,
  LiveSessionService,
  LiveSessionView,
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
  // 점검 대상이 LiveKit 연결·장치 상태라 서버 판정이 있어야 한다(CP1). 프론트가 흉내 내면
  // "점검 통과"가 거짓이 되므로 값을 지어내지 않는다.
  async getPreflightChecks(sessionId) {
    return notImplemented(`POST /instructor/live-sessions/${sessionId}/preflight`)
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
  // 실시간 자막은 WS 채널(CONTRACT §3-4)로 오게 되어 있고 REST 스냅샷 경로는 아직 없다(CP2).
  // 응답 정규화(captionAdapter)는 그대로 두었다 — 경로가 생기면 여기만 바꾸면 된다.
  async getCaptions(sessionId) {
    return notImplemented(`GET /live-sessions/${sessionId}/captions`)
  },
  async askLiveAi(lessonId) {
    return notImplemented(`POST /lessons/${lessonId}/ai/questions:stream`)
  },
  async saveBookmark(lessonId) {
    return notImplemented(`POST /lessons/${lessonId}/bookmarks`)
  },
  async getProcessingStatus(sessionId) {
    return notImplemented(`GET /instructor/live-sessions/${sessionId}/processing`)
  },
  async getQuestionHighlights(sessionId) {
    return notImplemented(`GET /instructor/live-sessions/${sessionId}/question-highlights`)
  },
} satisfies LiveSessionService
