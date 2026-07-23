import { demoCaptions, demoMessages, getDemoLiveSession } from '@/features/demo/demoData'
import { apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'

export interface LiveSessionView {
  sessionId: string
  lessonId: string
  lessonTitle: string
  curriculumId: string
  curriculumTitle: string
  sectionId: string
  status: CurriculumLiveSessionStatus
  scheduledAt: string | null
  entryOpensAt: string | null
  entryWindowMinutes: number
  expectedDurationMinutes: number
  participants: number
}

interface ApiLiveSessionView {
  sessionId: string
  lessonId: string
  liveSessionStatus: string
  scheduledAt: string | null
  entryWindowMinutes: number | null
  expectedDurationMinutes: number | null
}

export interface ChatMessageView {
  id: string
  alias: string
  text: string
  time: string
  question?: boolean
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

export interface CaptionView {
  at: string
  text: string
}

export interface PreflightCheck {
  code: string
  label: string
  value: string
  ready: boolean
}

export interface ProcessingStatus {
  steps: Array<{ label: string; status: 'COMPLETE' | 'PROCESSING' | 'PENDING' }>
  ready: boolean
}

export interface QuestionHighlight {
  at: string
  count: number
  text: string
}

export function getLiveSession(sessionId: string) {
  return requestByDataSource<LiveSessionView>({
    mock: () => ({ ...getDemoLiveSession(sessionId), entryWindowMinutes: 10 }),
    http: async () => {
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
      }
    },
    apiImplemented: true,
  })
}

export function getPreflightChecks(sessionId: string) {
  return requestByDataSource<PreflightCheck[]>({
    mock: () => [
      { code: 'LESSON_PUBLISHED', label: '강의 게시', value: 'PUBLISHED', ready: true },
      { code: 'MATERIAL_READY', label: 'PPTX 자료', value: '2개 준비', ready: true },
      { code: 'AI_READY', label: 'AI 준비', value: 'READY', ready: true },
      { code: 'LIVEKIT_READY', label: 'LiveKit', value: '연결 가능', ready: true },
      { code: 'EGRESS_READY', label: 'Egress 녹화', value: '저장 경로 준비', ready: true },
      { code: 'STT_READY', label: '실시간 자막', value: '처리 가능', ready: true },
    ],
    http: async () => {
      const { data } = await apiClient.post<PreflightCheck[]>(`/instructor/live-sessions/${sessionId}/preflight`)
      return data
    },
    apiImplemented: false,
  })
}

export function startLiveSession(sessionId: string) {
  return requestByDataSource({
    mock: () => undefined,
    http: async () => {
      await apiClient.post(`/live-sessions/${sessionId}/start`)
    },
    apiImplemented: true,
  })
}

export function endLiveSession(sessionId: string) {
  return requestByDataSource({
    mock: () => undefined,
    http: async () => {
      await apiClient.post(`/live-sessions/${sessionId}/end`)
    },
    apiImplemented: true,
  })
}

export function getLiveToken(sessionId: string) {
  return requestByDataSource<{ token: string; wsUrl?: string }>({
    mock: () => ({ token: `mock-token-${sessionId}` }),
    http: async () => {
      const { data } = await apiClient.post<ApiLiveToken>(`/live-sessions/${sessionId}/token`)
      return { token: data.accessToken, wsUrl: data.livekitUrl }
    },
    apiImplemented: true,
  })
}

export function getParticipants(sessionId: string) {
  return requestByDataSource<Array<{ alias: string; state: string; joinedAt: string }>>({
    mock: () => [
      { alias: '수강생-14A2', state: '시청 중', joinedAt: '09:52' },
      { alias: '수강생-09C1', state: 'DVR · 2분 전', joinedAt: '09:55' },
      { alias: '수강생-21B3', state: '시청 중', joinedAt: '10:03' },
    ],
    http: async () => {
      const { data } = await apiClient.get<ApiParticipant[]>(`/instructor/live-sessions/${sessionId}/participants`)
      return data.map((participant) => ({
        alias: participant.name || participant.identity,
        state: participant.state,
        joinedAt: new Date(participant.joinedAtEpochSeconds * 1000).toLocaleTimeString('ko-KR'),
      }))
    },
    apiImplemented: true,
  })
}

export function getChatMessages(sessionId: string) {
  return requestByDataSource<ChatMessageView[]>({
    mock: () => demoMessages,
    http: async () => {
      const { data } = await apiClient.get<ApiChatMessage[]>(`/live-sessions/${sessionId}/messages`)
      return data.map((message) => ({
        id: message.messageId,
        alias: message.alias,
        text: message.text,
        time: message.createdAt ? new Date(message.createdAt).toLocaleTimeString('ko-KR') : '-',
        question: message.isQuestion,
      }))
    },
    apiImplemented: true,
  })
}

export function sendChatMessage(sessionId: string, text: string, question: boolean) {
  return requestByDataSource<ChatMessageView>({
    mock: () => ({ id: `msg_${Date.now()}`, alias: '나', text, time: '현재', question }),
    http: async () => {
      const { data } = await apiClient.post<ApiChatMessage>(`/live-sessions/${sessionId}/messages`, {
        clientMessageId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        text,
        isQuestion: question,
        viewingSessionMs: null,
      })
      return {
        id: data.messageId,
        alias: data.alias,
        text: data.text,
        time: data.createdAt ? new Date(data.createdAt).toLocaleTimeString('ko-KR') : '현재',
        question: data.isQuestion,
      }
    },
    apiImplemented: true,
  })
}

export function getCaptions(sessionId: string) {
  return requestByDataSource<CaptionView[]>({
    mock: () => demoCaptions,
    http: async () => {
      const { data } = await apiClient.get<CaptionView[]>(`/live-sessions/${sessionId}/captions`)
      return data
    },
    apiImplemented: false,
  })
}

export function askLiveAi(lessonId: string, question: string) {
  return requestByDataSource<{ answer: string }>({
    mock: () => ({ answer: 'SecurityContext는 인증이 끝난 현재 요청의 사용자 정보를 보관합니다. 세션 저장소와는 책임이 다르며, 요청이 끝나면 컨텍스트가 정리됩니다.' }),
    http: async () => {
      const { data } = await apiClient.post<{ answer: string }>(`/lessons/${lessonId}/ai/questions:stream`, { question })
      return data
    },
    apiImplemented: false,
  })
}

export function saveBookmark(lessonId: string, sessionMs: number) {
  return requestByDataSource({
    mock: () => undefined,
    http: async () => {
      await apiClient.post(`/lessons/${lessonId}/bookmarks`, { sessionMs })
    },
    apiImplemented: false,
  })
}

export function getProcessingStatus(sessionId: string) {
  return requestByDataSource<ProcessingStatus>({
    mock: () => ({
      steps: [
        { label: '녹화 종료 요청', status: 'COMPLETE' },
        { label: 'HLS 세그먼트 정리', status: 'COMPLETE' },
        { label: '재생 가능성 검증', status: 'COMPLETE' },
        { label: '다시보기 검수 준비', status: 'PROCESSING' },
      ],
      ready: false,
    }),
    http: async () => {
      const { data } = await apiClient.get<ProcessingStatus>(`/instructor/live-sessions/${sessionId}/processing`)
      return data
    },
    apiImplemented: false,
  })
}

export function getQuestionHighlights(sessionId: string) {
  return requestByDataSource<QuestionHighlight[]>({
    mock: () => [
      { at: '12:18', count: 3, text: '세션과 JWT를 함께 사용하는 기준이 궁금해요.' },
      { at: '27:40', count: 5, text: '필터 순서가 실제 인증에 어떤 영향을 주나요?' },
      { at: '41:05', count: 2, text: 'Redis 장애 시 세션 복구 방식이 궁금해요.' },
    ],
    http: async () => {
      const { data } = await apiClient.get<QuestionHighlight[]>(`/instructor/live-sessions/${sessionId}/question-highlights`)
      return data
    },
    apiImplemented: false,
  })
}
