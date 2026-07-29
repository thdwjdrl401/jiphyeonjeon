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
  /**
   * 스트림이 아직 끝나지 않아 더 자랄 수 있는 진행 중 라이브 라인이면 true.
   * `caption.stream.completed`를 받은(확정된) 라인이나 세그먼트형 다시보기 자막에는 없다.
   */
  pending?: boolean
  /**
   * `startMs`가 근사 **세션-ms 축**(sessionMs, occurredAt−clockOriginAt)에 놓여 HLS 플레이어 위치와
   * 같은 축인지. true면 학생 위치 동기화가 이 자막을 `positionMs` 기준으로 노출/하이라이트한다.
   * false(clockOriginAt 없음 등 fallback)면 세션 축이 아니라 stream-local 축이라 위치 동기화가 불가능해
   * 라이브 append처럼 그대로 보인다(ADR-0045).
   */
  synced?: boolean
}

/**
 * 실시간 자막 델타(append-only 증분). 계약: CONTRACT §3-4 / ADR-0040·0043.
 * `streamElapsedMs`는 agent의 첫 오디오 프레임을 0으로 한 attempt-local ms이며
 * 세션 상대 ms가 아니다(계약상 변환 금지). `sequence`는 `(sessionId, sttSessionId)`
 * attempt 범위에서만 증가하고 retry(새 `sttSessionId`)마다 1부터 다시 시작할 수 있다.
 */
export interface CaptionDeltaPayload {
  sttSessionId: string
  sequence: number
  streamElapsedMs: number
  /**
   * 근사 **세션-ms**(occurredAt−clockOriginAt, 서버 계산, ADR-0045). HLS 영상 위치(positionMs)와 같은 축이라
   * 학생 위치 동기화의 기준이다. streamElapsedMs 변환이 아니라 별도 근사 축이며, clockOriginAt이 없으면
   * null — 그때는 streamElapsedMs로 fallback한다.
   */
  sessionMs?: number | null
  text: string
}

/** 스트림 종료 마커. 해당 `sttSessionId`에는 더 이상 델타가 오지 않는다. */
export interface CaptionStreamCompletedPayload {
  sttSessionId: string
  lastSequence: number
  /** 델타와 정합을 위한 근사 세션-ms(nullable, ADR-0045). */
  sessionMs?: number | null
  reason: string
}

export type CaptionStreamEvent =
  | { type: 'caption.delta'; occurredAt: string; payload: CaptionDeltaPayload }
  | { type: 'caption.stream.completed'; occurredAt: string; payload: CaptionStreamCompletedPayload }

export interface PreflightRoom {
  sessionId: string
  roomName: string
  roomSid: string
}

export interface PreflightReadiness {
  ready: boolean
  instructorPresent: boolean
  microphonePublished: boolean
  microphoneMuted: boolean
  instructorMicrophoneTrackCount: number
  unexpectedMicrophonePublishers: number
}

export interface LiveStartOperation {
  operationId: string | null
  sessionId: string
  status: 'STARTING' | 'LIVE'
}

export interface LiveStartStatus {
  operationId: string | null
  attemptStatus: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | null
  step: 'ACCEPTED' | 'STT_DISPATCHED' | 'EGRESS_STARTING' | 'EGRESS_READY' | 'PUBLISHER_RECHECK' | 'LIVE' | 'FAILED' | null
  failureCode: string | null
  failureMessage: string | null
  session: LiveSessionView
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

/**
 * 재생 metadata(CONTRACT §2 다시보기). 라이브 되감기와 종료 후 다시보기가 같은 응답을 쓴다.
 *
 * source가 하나인 이유: 라이브 중 재생목록은 `#EXT-X-ENDLIST` 없이 자라는 EVENT 목록이라
 * 라이브 엣지와 세션 처음까지의 seek을 한 목록이 동시에 준다. 갱신 크기는 서버가 델타
 * 재생목록으로 잡으므로 프론트가 source를 갈아끼울 일이 없다.
 */
export interface PlaybackView {
  lessonId: string
  sessionId: string
  /** STARTING/LIVE/ENDING이면 라이브, ENDED면 종료. 플레이어 UI와 폴링 주기를 가른다. */
  liveSessionStatus: string
  /** 재생 가능한 최신 지점(세션 상대 ms) = 라이브 엣지. */
  currentSessionMs: number | null
  /** 종료된 녹화의 총 길이(ms). 라이브 중에는 null. */
  durationMs: number | null
  /** manifest가 아직 없으면(Egress 지연) null — 오류가 아니라 대기 상태다. */
  source: PlaybackSourceView | null
}

export interface PlaybackSourceView {
  /** 인증된 manifest 엔드포인트. same-origin이라 세션 쿠키가 그대로 실린다. */
  url: string
  /**
   * 이 source가 담는 구간의 시작(세션 상대 ms). **미디어 시각 0이 가리키는 세션 시각**이라
   * 자막 싱크의 기준이다. 최상위 필드가 아니라 이 값을 써야 한다.
   */
  availableFromMs: number | null
  /** 이 source가 담는 구간의 끝(세션 상대 ms). */
  availableToMs: number | null
}

export interface LiveSessionService {
  getLiveSession: (sessionId: string) => Promise<LiveSessionView>
  /** 레슨 기준이다 — 권한이 레슨→커리큘럼→수강 관계로만 판정되기 때문(CONTRACT §2). */
  getPlayback: (lessonId: string) => Promise<PlaybackView>
  preparePreflightRoom: (sessionId: string) => Promise<PreflightRoom>
  getPreflightReadiness: (sessionId: string) => Promise<PreflightReadiness>
  startLiveSession: (sessionId: string) => Promise<LiveStartOperation>
  getLiveStartStatus: (sessionId: string, operationId?: string) => Promise<LiveStartStatus>
  endLiveSession: (sessionId: string) => Promise<void>
  /** 강사 WebRTC 송출 전용 토큰. 수강생 재생은 LiveKit이 아니라 HLS를 사용한다. */
  getInstructorLiveToken: (sessionId: string) => Promise<{ token: string; wsUrl?: string }>
  getParticipants: (sessionId: string) => Promise<Array<{ alias: string; state: string; joinedAt: string }>>
  getChatMessages: (sessionId: string) => Promise<ChatMessageView[]>
  sendChatMessage: (sessionId: string, text: string, question: boolean) => Promise<ChatMessageView>
  subscribeChatMessages: (
    sessionId: string,
    onMessage: (message: ChatMessageView) => void,
    onConnectionChange: (state: ChatConnectionState) => void,
  ) => () => void
  /**
   * 저장된 자막 리로드(REST `GET /live-sessions/{id}/captions`, CAPTION-01). WS 델타/종료와 같은 필드의
   * 스트림 이벤트 목록을 세션-ms 순으로 돌려준다 — 마운트 시 WS 누적기에 그대로 시드해 새로고침·재연결
   * 뒤 자막을 복원한다. 실시간 렌더는 subscribeCaptions(WS)가 이어서 구동한다.
   */
  getCaptions: (sessionId: string) => Promise<CaptionStreamEvent[]>
  /**
   * 라이브 자막 델타 스트림 구독(STOMP `/topic/live-sessions/{id}/captions`).
   * 채팅 구독과 대칭이며, `caption.delta`·`caption.stream.completed`만 onEvent로 넘긴다.
   * 누적·CaptionView 매핑은 captionAdapter의 reduceCaptionStream/selectCaptionViews가 맡는다.
   */
  subscribeCaptions: (
    sessionId: string,
    onEvent: (event: CaptionStreamEvent) => void,
    onConnectionChange: (state: ChatConnectionState) => void,
  ) => () => void
  askLiveAi: (lessonId: string, question: string) => Promise<{ answer: string }>
  saveBookmark: (lessonId: string, sessionMs: number) => Promise<void>
  getProcessingStatus: (sessionId: string) => Promise<ProcessingStatus>
  getQuestionHighlights: (sessionId: string) => Promise<QuestionHighlight[]>
}
