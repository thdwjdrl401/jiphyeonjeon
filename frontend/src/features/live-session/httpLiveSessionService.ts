import { Client, type IMessage } from '@stomp/stompjs'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import { ApiError, apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type {
  ChatMessageView,
  LiveSessionService,
  LiveSessionView,
  PlaybackView,
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

interface ApiChatEnvelope {
  type: string
  sessionId: string
  payload: ApiChatMessage
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

interface ApiPlaybackSource {
  url: string
  availableFromMs: number | null
  availableToMs: number | null
}

interface ApiPlayback {
  lessonId: string
  sessionId: string
  liveSessionStatus: string
  currentSessionMs: number | null
  durationMs: number | null
  source: ApiPlaybackSource | null
}

function nullableNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value
}

function normalizePlayback(data: ApiPlayback, lessonId: string): PlaybackView {
  // source가 null인 건 정상 상태다 — Egress가 아직 첫 세그먼트를 안 올렸다는 뜻이라
  // 계약 위반으로 다루면 대기 화면 대신 오류 화면이 뜬다.
  const url = data.source?.url?.trim()
  if (data.lessonId !== lessonId || (data.source && !url) || !data.liveSessionStatus) {
    throw new ApiError(
      '재생 API 응답이 계약과 일치하지 않습니다.',
      undefined,
      'PLAYBACK_CONTRACT_INVALID',
    )
  }

  return {
    lessonId: data.lessonId,
    sessionId: data.sessionId,
    liveSessionStatus: data.liveSessionStatus,
    currentSessionMs: nullableNumber(data.currentSessionMs),
    durationMs: nullableNumber(data.durationMs),
    source: url
      ? {
          url,
          availableFromMs: nullableNumber(data.source?.availableFromMs),
          availableToMs: nullableNumber(data.source?.availableToMs),
        }
      : null,
  }
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

function getChatBrokerUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/ws`
}

function readChatEnvelope(frame: IMessage, sessionId: string) {
  const envelope = JSON.parse(frame.body) as ApiChatEnvelope
  if (envelope.type !== 'chat.message.created' || envelope.sessionId !== sessionId) return null
  return normalizeMessage(envelope.payload)
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
  async getPlayback(lessonId) {
    const { data } = await apiClient.get<ApiPlayback>(`/lessons/${lessonId}/playback`)
    return normalizePlayback(data, lessonId)
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
  subscribeChatMessages(sessionId, onMessage, onConnectionChange) {
    let active = true
    onConnectionChange('connecting')

    const client = new Client({
      brokerURL: getChatBrokerUrl(),
      connectionTimeout: 10_000,
      heartbeatIncoming: 10_000,
      heartbeatOutgoing: 10_000,
      reconnectDelay: 3_000,
    })

    client.onConnect = () => {
      if (!active) return
      onConnectionChange('connected')
      client.subscribe(`/topic/live-sessions/${sessionId}/chat`, (frame) => {
        try {
          const message = readChatEnvelope(frame, sessionId)
          if (message) onMessage(message)
        } catch {
          onConnectionChange('error')
        }
      })
    }
    client.onStompError = () => {
      if (active) onConnectionChange('error')
    }
    client.onWebSocketError = () => {
      if (active) onConnectionChange('reconnecting')
    }
    client.onWebSocketClose = () => {
      if (active) onConnectionChange('reconnecting')
    }
    client.activate()

    return () => {
      active = false
      onConnectionChange('disconnected')
      void client.deactivate()
    }
  },
  // 실시간 자막은 WS 채널(CONTRACT §3-4)로 오게 되어 있고 REST 스냅샷 경로는 아직 없다(CP2).
  // 응답 정규화(captionAdapter)는 그대로 두었다 — 경로가 생기면 여기만 바꾸면 된다.
  async getCaptions(sessionId) {
    return notImplemented(`GET /live-sessions/${sessionId}/captions`)
  },
  async askLiveAi(lessonId) {
    return notImplemented(`POST /lessons/${lessonId}/ai/questions:stream`)
  },
  async saveBookmark(lessonId, sessionMs) {
    await apiClient.post(`/lessons/${lessonId}/bookmarks`, { sessionMs })
  },
  async getProcessingStatus(sessionId) {
    return notImplemented(`GET /instructor/live-sessions/${sessionId}/processing`)
  },
  async getQuestionHighlights(sessionId) {
    return notImplemented(`GET /instructor/live-sessions/${sessionId}/question-highlights`)
  },
} satisfies LiveSessionService
