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

export interface ChatMessageView {
  id: string
  alias: string
  text: string
  time: string
  question?: boolean
}

export type ChatConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export interface CaptionTermReference {
  termId: string
  startIndex: number
  endIndex: number
}

export interface CaptionView {
  segmentId: string
  startMs: number
  endMs: number
  at: string
  text: string
  termReferences: CaptionTermReference[]
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

export interface LivePlaybackView {
  sessionId: string
  playbackUrl: string
  mimeType: 'application/vnd.apple.mpegurl'
  streamType: 'LIVE_DVR'
  sessionOffsetMs: number | null
}

export interface LiveSessionService {
  getLiveSession: (sessionId: string) => Promise<LiveSessionView>
  getLivePlayback: (sessionId: string) => Promise<LivePlaybackView>
  getPreflightChecks: (sessionId: string) => Promise<PreflightCheck[]>
  startLiveSession: (sessionId: string) => Promise<void>
  endLiveSession: (sessionId: string) => Promise<void>
  getLiveToken: (sessionId: string) => Promise<{ token: string; wsUrl?: string }>
  getParticipants: (sessionId: string) => Promise<Array<{ alias: string; state: string; joinedAt: string }>>
  getChatMessages: (sessionId: string) => Promise<ChatMessageView[]>
  sendChatMessage: (sessionId: string, text: string, question: boolean) => Promise<ChatMessageView>
  subscribeChatMessages: (
    sessionId: string,
    onMessage: (message: ChatMessageView) => void,
    onConnectionChange: (state: ChatConnectionState) => void,
  ) => () => void
  getCaptions: (sessionId: string) => Promise<CaptionView[]>
  askLiveAi: (lessonId: string, question: string) => Promise<{ answer: string }>
  saveBookmark: (lessonId: string, sessionMs: number) => Promise<void>
  getProcessingStatus: (sessionId: string) => Promise<ProcessingStatus>
  getQuestionHighlights: (sessionId: string) => Promise<QuestionHighlight[]>
}
