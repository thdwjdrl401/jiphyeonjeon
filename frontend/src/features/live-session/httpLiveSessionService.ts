import { Client, type IMessage } from '@stomp/stompjs'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import { ApiError, apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type {
  CaptionStreamEvent,
  ChatMessageView,
  LiveStartOperation,
  LiveStartStatus,
  LiveSessionService,
  LiveSessionView,
  PreflightReadiness,
  PreflightRoom,
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

interface ApiCaptionDeltaPayload {
  sttSessionId: string
  sequence: number
  streamElapsedMs: number
  sessionMs: number | null
  text: string
}

interface ApiCaptionCompletedPayload {
  sttSessionId: string
  lastSequence: number
  sessionMs: number | null
  reason: string
}

/** 리로드 응답 한 줄(WS payload와 정합, type으로 delta/completed 구분). CAPTION-01 / ADR-0045. */
interface ApiCaptionReloadItem {
  type: string
  sttSessionId: string
  sequence: number | null
  lastSequence: number | null
  streamElapsedMs: number
  sessionMs: number | null
  text: string | null
  reason: string | null
  occurredAt: string
}

interface ApiCaptionEnvelope {
  type: string
  sessionId: string
  occurredAt: string
  payload: unknown
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

interface ApiPreflightRoom {
  sessionId: string
  roomName: string
  roomSid: string
}

interface ApiPreflightReadiness {
  ready: boolean
  instructorPresent: boolean
  microphonePublished: boolean
  microphoneMuted: boolean
  instructorMicrophoneTrackCount: number
  unexpectedMicrophonePublishers: number
}

interface ApiLiveStartOperation {
  operationId: string | null
  sessionId: string
  status: 'STARTING' | 'LIVE'
}

interface ApiLiveStartStatus {
  operationId: string | null
  attemptStatus: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | null
  step: LiveStartStatus['step']
  failureCode: string | null
  failureMessage: string | null
  session: ApiLiveSessionView
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

function normalizeLiveSession(data: ApiLiveSessionView): LiveSessionView {
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

function getBrokerUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/ws`
}

function readChatEnvelope(frame: IMessage, sessionId: string) {
  const envelope = JSON.parse(frame.body) as ApiChatEnvelope
  if (envelope.type !== 'chat.message.created' || envelope.sessionId !== sessionId) return null
  return normalizeMessage(envelope.payload)
}

// 자막 봉투는 채팅과 동형(WsEnvelope)에 occurredAt이 더 있다. delta·completed 2종만 통과시키고
// 그 외 type/타 세션은 무시한다(§3-4 / ADR-0043). streamElapsedMs 등 raw 값은 그대로 넘긴다.
function readCaptionEnvelope(frame: IMessage, sessionId: string): CaptionStreamEvent | null {
  const envelope = JSON.parse(frame.body) as ApiCaptionEnvelope
  if (envelope.sessionId !== sessionId) return null
  if (envelope.type === 'caption.delta') {
    const payload = envelope.payload as ApiCaptionDeltaPayload
    return {
      type: 'caption.delta',
      occurredAt: envelope.occurredAt,
      payload: {
        sttSessionId: payload.sttSessionId,
        sequence: payload.sequence,
        streamElapsedMs: payload.streamElapsedMs,
        sessionMs: payload.sessionMs ?? null,
        text: payload.text,
      },
    }
  }
  if (envelope.type === 'caption.stream.completed') {
    const payload = envelope.payload as ApiCaptionCompletedPayload
    return {
      type: 'caption.stream.completed',
      occurredAt: envelope.occurredAt,
      payload: {
        sttSessionId: payload.sttSessionId,
        lastSequence: payload.lastSequence,
        sessionMs: payload.sessionMs ?? null,
        reason: payload.reason,
      },
    }
  }
  return null
}

// 리로드 응답 한 줄을 WS 누적기가 먹는 CaptionStreamEvent로 옮긴다. 미지 type은 버린다.
function toCaptionStreamEvent(item: ApiCaptionReloadItem): CaptionStreamEvent[] {
  if (item.type === 'caption.delta') {
    return [{
      type: 'caption.delta',
      occurredAt: item.occurredAt,
      payload: {
        sttSessionId: item.sttSessionId,
        sequence: item.sequence ?? 0,
        streamElapsedMs: item.streamElapsedMs,
        sessionMs: item.sessionMs ?? null,
        text: item.text ?? '',
      },
    }]
  }
  if (item.type === 'caption.stream.completed') {
    return [{
      type: 'caption.stream.completed',
      occurredAt: item.occurredAt,
      payload: {
        sttSessionId: item.sttSessionId,
        lastSequence: item.lastSequence ?? 0,
        sessionMs: item.sessionMs ?? null,
        reason: item.reason ?? '',
      },
    }]
  }
  return []
}

export const httpLiveSessionService = {
  async getLiveSession(sessionId) {
    const { data } = await apiClient.get<ApiLiveSessionView>(`/live-sessions/${sessionId}`)
    return normalizeLiveSession(data)
  },
  async getPlayback(lessonId) {
    const { data } = await apiClient.get<ApiPlayback>(`/lessons/${lessonId}/playback`)
    return normalizePlayback(data, lessonId)
  },
  async preparePreflightRoom(sessionId) {
    const { data } = await apiClient.post<ApiPreflightRoom>(
      `/instructor/live-sessions/${sessionId}/preflight`,
    )
    return data satisfies PreflightRoom
  },
  async getPreflightReadiness(sessionId) {
    const { data } = await apiClient.get<ApiPreflightReadiness>(
      `/instructor/live-sessions/${sessionId}/preflight/readiness`,
    )
    return data satisfies PreflightReadiness
  },
  async startLiveSession(sessionId) {
    const { data } = await apiClient.post<ApiLiveStartOperation>(`/live-sessions/${sessionId}/start`)
    return data satisfies LiveStartOperation
  },
  async getLiveStartStatus(sessionId, operationId) {
    const { data } = await apiClient.get<ApiLiveStartStatus>(
      `/live-sessions/${sessionId}/start-status`,
      operationId ? { params: { operationId } } : undefined,
    )
    return {
      ...data,
      session: normalizeLiveSession(data.session),
    } satisfies LiveStartStatus
  },
  async endLiveSession(sessionId) {
    await apiClient.post(`/live-sessions/${sessionId}/end`)
  },
  async getInstructorLiveToken(sessionId) {
    const { data } = await apiClient.post<ApiLiveToken>(`/instructor/live-sessions/${sessionId}/token`)
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
      brokerURL: getBrokerUrl(),
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
  // 라이브 자막 델타 스트림. 채팅 구독과 대칭이며 같은 /api/ws에 붙어 captions 토픽만 구독한다.
  // 구독 인가(참가자만)는 서버 STOMP 인터셉터가 처리한다(ADR-0043) — FE는 토픽 구독만 한다.
  subscribeCaptions(sessionId, onEvent, onConnectionChange) {
    let active = true
    onConnectionChange('connecting')

    const client = new Client({
      brokerURL: getBrokerUrl(),
      connectionTimeout: 10_000,
      heartbeatIncoming: 10_000,
      heartbeatOutgoing: 10_000,
      reconnectDelay: 3_000,
    })

    client.onConnect = () => {
      if (!active) return
      onConnectionChange('connected')
      client.subscribe(`/topic/live-sessions/${sessionId}/captions`, (frame) => {
        try {
          const event = readCaptionEnvelope(frame, sessionId)
          if (event) onEvent(event)
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
  // 저장된 자막 리로드(CAPTION-01, ADR-0045). 새로고침·재연결 뒤 세션-ms 순 자막을 복원해 WS 누적기에
  // 시드한다 — WS 델타와 같은 필드다. 라이브 렌더는 이어서 subscribeCaptions(WS)가 구동한다.
  async getCaptions(sessionId) {
    const { data } = await apiClient.get<ApiCaptionReloadItem[]>(`/live-sessions/${sessionId}/captions`)
    return data.flatMap(toCaptionStreamEvent)
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
