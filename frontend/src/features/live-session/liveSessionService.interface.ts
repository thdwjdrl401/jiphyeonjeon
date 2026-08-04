import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'

export interface LiveSessionView {
  sessionId: string
  lessonId: string
  lessonTitle: string
  curriculumId: string
  curriculumTitle: string
  sectionId: string
  sectionTitle: string
  status: CurriculumLiveSessionStatus
  scheduledAt: string | null
  entryOpensAt: string | null
  entryWindowMinutes: number
  expectedDurationMinutes: number
  participants: number
}

export interface ChatMessageView {
  id: string
  /**
   * 전송할 때 클라이언트가 만든 키. 서버 응답·WS 에코·낙관적 항목을 같은 메시지로 잇는다.
   * WS 브로드캐스트 payload에는 `mine`이 없으므로(뷰어별이 될 수 없다) 라이브 중 "내 메시지" 판별은
   * 이 값이 내가 보낸 것인지로 한다. 데모·다시보기처럼 전송 경로를 거치지 않은 항목엔 없다.
   */
  clientMessageId?: string
  /**
   * 노출 이름. 발신자가 익명을 선택했으면 세션 한정 가명(수강생-0473), 아니면 발신자가 스스로 지정한
   * 표시 이름이다(ADR-0050). 강사는 항상 표시 이름이다.
   */
  alias: string
  text: string
  time: string
  /**
   * 서버가 확정한 세션 상대 시각(ms). 영상 위치(`positionMs`)와 <b>같은 축</b>이라, 다시보기에서
   * "지금 재생 위치까지 올라온 채팅"을 고르는 기준이 된다.
   *
   * <p>`time`이 있는데도 이 값이 따로 필요한 이유는, `time`이 벽시계를 사람이 읽을 문자열로 바꾼
   * 값이라 되감기와 맞출 좌표가 아니기 때문이다.
   *
   * <p>서버가 아직 확정하지 않은 낙관적 항목에는 없다.
   */
  sessionMs?: number | null
  question?: boolean
  /** 요청자 본인이 보낸 메시지(REST `mine` 또는 내 clientMessageId 에코). 우측 정렬용. */
  mine?: boolean
  /** 서버가 아직 확정하지 않은 낙관적 항목(전송 중). */
  pending?: boolean
}

/**
 * 채팅 전송 입력. `clientMessageId`는 호출자(화면)가 만든다 — 낙관적 항목을 먼저 그려 두고 서버 응답·WS
 * 에코와 같은 메시지로 이으려면 전송 전에 키를 알아야 한다.
 */
export interface SendChatMessageInput {
  clientMessageId: string
  text: string
  question: boolean
  /**
   * 익명 전송(수강생 선택, ADR-0050). false면 발신자가 지정한 표시 이름이 노출된다.
   * 강사는 익명이 될 수 없어 서버가 이 값을 무시한다.
   */
  anonymous: boolean
}

export type ChatConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export type LiveSessionStateEvent =
  | {
      type: 'session.ending'
      occurredAt: string
      payload: { liveSessionStatus: 'ENDING'; endedAt: null }
    }
  | {
      type: 'session.ended'
      occurredAt: string
      payload: { liveSessionStatus: 'ENDED'; endedAt: string }
    }
  /**
   * 지금 강의실에 들어와 있는 수강생 수. 강사는 포함하지 않는다.
   *
   * 수강생은 LiveKit 방에 들어오지 않으므로(ADR-0032) 방 참여자 목록으로는 청중을 셀 수 없다.
   * 서버는 세션 토픽 구독을 사람 단위로 세어 이 이벤트로 알려준다.
   */
  | {
      type: 'session.presence'
      occurredAt: string
      payload: { participantCount: number }
    }

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

/**
 * 확정된 발화 세그먼트 경계(AI가 내려 주는 권위 있는 문장 단위). 문장부호 휴리스틱(ADR-0044)을 대체한다.
 * `text`는 누적 델타를 **덮어쓰는** 이 세그먼트의 최종 텍스트다. `startStreamElapsedMs`/`endStreamElapsedMs`는
 * attempt-local raw ms(변환 금지). `lastSequence`는 이 세그먼트가 덮는 델타 sequence의 최댓값 —
 * 이보다 큰 sequence의 델타만 아직 확정 안 된 진행 중 조각이다.
 */
export interface CaptionSegmentFinalPayload {
  sttSessionId: string
  segmentIndex: number
  lastSequence: number
  text: string
  startStreamElapsedMs: number
  endStreamElapsedMs: number
  boundaryReason: 'SILENCE' | 'MAX_DURATION' | 'STREAM_END'
  /** 근사 세션-ms(델타·완료 payload와 같은 의미, nullable, ADR-0045). */
  sessionMs?: number | null
}

export type CaptionStreamEvent =
  | { type: 'caption.delta'; occurredAt: string; payload: CaptionDeltaPayload }
  | { type: 'caption.segment.final'; occurredAt: string; payload: CaptionSegmentFinalPayload }
  | { type: 'caption.stream.completed'; occurredAt: string; payload: CaptionStreamCompletedPayload }

/**
 * 라이브 AI 답변의 근거 한 건(ADR-0047 §2 / LIVE.md §10.1).
 *
 * 프록시가 ai-api 스키마를 **변환 없이** 릴레이하므로 FE도 원본 좌표를 그대로 받는다.
 * 최초 등장 순서가 보존되고 중복은 서버가 제거한다.
 */
/**
 * AI 답변이 근거로 삼은 자료 한 조각.
 *
 * <p>`excerpt`가 <b>사람이 읽을 유일한 값</b>이다. materialId·sttSessionId는 UUID라 화면에
 * 보여 줄 것이 못 되고, 서버는 처음부터 발췌문을 함께 보내 왔다(계약상 선택 필드라 옛 답변에는
 * 없을 수 있다).
 */
export type AiAnswerSource =
  | { type: 'PPTX'; materialId: string; page: number; excerpt?: string }
  /**
   * 라이브(v1) 자막 근거.
   *
   * ⚠️ `startMs`/`endMs`는 STT **attempt-local `streamElapsedMs`** 축이다(자막 델타와 같은 축).
   * 영상 위치(`sessionMs`)와 **다른 축**이라 이 값으로 seek을 걸면 엉뚱한 지점으로 간다 —
   * 표시만 한다(ADR-0043·0045·0047).
   */
  | {
      type: 'CAPTION'
      sessionId: string
      sttSessionId: string
      startMs: number
      endMs: number
      excerpt?: string
      /** Replay v2 녹화강의 근거는 플레이어와 동일한 MP4 시간축이고, 미지정(v1)은 STT 스트림 축이다. */
      timeAxis?: 'STT_STREAM' | 'PLAYBACK'
    }

/**
 * AI 답변 SSE 이벤트. 한 스트림 = `answer.delta` 0개 이상 + terminal(`done`|`insufficient`|`error`) 정확히 하나.
 *
 * `answer.error`는 스트림이 **시작된 뒤**의 실패다(HTTP 상태는 200 그대로). 프록시 자신의 실패도
 * 같은 모양으로 오므로(`PROXY_UPSTREAM_FAILED`·`PROXY_STREAM_INCOMPLETE`) 화면 분기는 하나면 된다.
 * 스트림이 **시작되기 전**의 실패는 이벤트가 아니라 `ApiError`(400/401/403/404/409/502/503)로 던진다.
 */
export type AiAnswerStreamEvent =
  | { type: 'answer.delta'; payload: { requestId: string; text: string } }
  | { type: 'answer.done'; payload: { requestId: string; sources: AiAnswerSource[] } }
  | { type: 'answer.insufficient'; payload: { requestId: string; message: string } }
  | { type: 'answer.error'; payload: { requestId: string; code: string; message: string; retryable: boolean } }

export interface AiAnswerStreamOptions {
  /** 도착한 순서 그대로 넘긴다. 델타 누적·상태 전이는 `features/ai`의 reduceAiAnswer가 맡는다. */
  onEvent: (event: AiAnswerStreamEvent) => void
  /**
   * 중단 신호. 끊으면 서버가 ai-api 연결까지 정리한다(ADR-0047 §6). 중단된 호출은 오류가 아니라
   * **조용히 resolve**한다 — 취소는 사용자가 방금 한 행동이지 실패가 아니다.
   */
  signal?: AbortSignal
}

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

/** 녹화 자산이 지나는 단계. 라이브 종료와 무관하게 Egress 완료 webhook이 진행시킨다. */
export type VideoAssetStatus =
  | 'STARTING' | 'RECORDING' | 'FINALIZING' | 'VERIFYING' | 'READY' | 'FAILED'

/** 다시보기 게시 축. 새 정상 녹화는 READY와 함께 게시되지만 기존 미게시·철회 자산은 별도 상태로 남는다. */
export type ReplayStatus = 'DRAFT' | 'READY_FOR_REVIEW' | 'PUBLISHED' | 'WITHDRAWN'

/**
 * 종료 후 처리 현황(CONTRACT §2-2).
 *
 * 서버는 <b>상태만</b> 준다. "HLS 세그먼트 정리 중" 같은 표시 문구는 이 화면이 고른다 — 문구를 계약에
 * 넣으면 한 줄 고치는 데 서버 배포가 필요해진다.
 */
export interface ProcessingStatus {
  sessionId: string
  liveSessionStatus: LiveSessionView['status']
  /** 녹화를 켜고 진행했는가. `videoAsset`이 null일 때 "아직 없음"과 "애초에 녹화 안 함"을 가른다. */
  recordingEnabled: boolean
  startedAt: string | null
  endedAt: string | null
  /** 녹화 자산. 아직 만들어지지 않았으면 null — 이 부재는 실패가 아니다. */
  videoAsset: {
    videoAssetId: string
    status: VideoAssetStatus
    replayStatus: ReplayStatus | null
    /** `status === 'FAILED'`일 때의 안정적인 code. 아니면 null. */
    failureCode: string | null
    durationMs: number | null
    sizeBytes: number | null
    recordingStartedAt: string | null
    recordingEndedAt: string | null
  } | null
}

/**
 * AI가 자막에서 만든 주제별 강의 노트의 **현재 전체**(CONTRACT §3-4a).
 *
 * 증분이 아니라 늘 전체다 — 조각 이어 붙이기는 서버가 한 번만 하고, 그 결과가 새로고침·재연결·실시간
 * 모두에서 같아야 한다. 조회 응답과 WebSocket payload가 같은 모양인 이유도 그것이다.
 */
export interface LectureNoteTopic {
  topicId?: string
  title: string
  keyPoints: string[]
}

export interface LectureNoteView {
  /** 이 노트가 반영한 자막 진행도. 오래된 갱신을 버리는 기준. */
  coveredThroughSequence: number
  topics: LectureNoteTopic[]
  markdown: string
  /** CAPTURING(자라는 중) · COMPLETED(자막 수집 종료) · REFINED(종료 후 정제본으로 교체됨) */
  status: 'CAPTURING' | 'COMPLETED' | 'REFINED'
  updatedAt: string | null
}

/**
 * 이 세션에서 <b>내가</b> 한 AI 질문 한 건(ADR-0047 확장). 새로고침·재접속 복구용이다.
 *
 * 개인 질문이라 남의 것은 조회되지 않는다 — 무엇을 모르는지가 드러나면 안 된다.
 */
export interface AiAnswerHistoryItem {
  requestId: string
  question: string
  /** 이어 붙인 최종 답변. 실패로 끝났으면 받은 데까지만 있다. */
  answer: string
  /** 근거 목록의 JSON 문자열. 서버는 해석하지 않는다. */
  sources: string
  status: 'DONE' | 'INSUFFICIENT' | 'ERROR'
  failureCode: string | null
  askedAt: string
}

/** 재생바 아래 그래프(ADR-0063). 절대 횟수가 아니라 도달자 수로 나눈 강도다. */
export interface WatchHeatmap {
  /** 저장 칸 길이(ms). 점 하나가 몇 초인지 계산할 때 쓴다. */
  bucketSizeMs: number
  /** 0.0 이상. 1.0이면 도달한 사람이 평균 한 번, 2.0이면 두 번 봤다. 최대 100점. */
  points: number[]
  /** 가장 많은 사람이 도달한 칸의 인원. */
  viewers: number
}

/** 강의 용어집 한 줄. AI가 자료에서 뽑은 것을 강사 수정본이 덮어쓴 결과다. */
export interface GlossaryTerm {
  /** 용어 이름 그대로. 자막에서 이 문자열을 찾아 링크를 건다. */
  termId: string
  term: string
  definition: string
  /** MATERIAL(AI가 자료에서 뽑음) · INSTRUCTOR(강사가 고치거나 더함) */
  source: 'MATERIAL' | 'INSTRUCTOR'
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
  /** 영상 다시보기 공개 상태. 자막·요약 등 AI 게시 상태와는 별개다. */
  replayStatus: ReplayStatus
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
  endLiveSession: (sessionId: string) => Promise<LiveSessionView>
  /** 강사 WebRTC 송출 전용 토큰. 수강생 재생은 LiveKit이 아니라 HLS를 사용한다. */
  getInstructorLiveToken: (sessionId: string) => Promise<{ token: string; wsUrl?: string }>
  getParticipants: (sessionId: string) => Promise<Array<{ alias: string; state: string; joinedAt: string }>>
  getChatMessages: (sessionId: string) => Promise<ChatMessageView[]>
  sendChatMessage: (sessionId: string, input: SendChatMessageInput) => Promise<ChatMessageView>
  subscribeChatMessages: (
    sessionId: string,
    onMessage: (message: ChatMessageView) => void,
    onConnectionChange: (state: ChatConnectionState) => void,
  ) => () => void
  /** 세션 종료 상태 구독. ENDING은 안내만, ENDED는 학생 상호작용 잠금의 권위 있는 신호다. */
  subscribeSessionState: (
    sessionId: string,
    onEvent: (event: LiveSessionStateEvent) => void,
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
   * 채팅 구독과 대칭이며, `caption.delta`·`caption.segment.final`·`caption.stream.completed`만 onEvent로 넘긴다.
   * 누적·CaptionView 매핑은 captionAdapter의 reduceCaptionStream/selectCaptionViews가 맡는다.
   */
  subscribeCaptions: (
    sessionId: string,
    onEvent: (event: CaptionStreamEvent) => void,
    onConnectionChange: (state: ChatConnectionState) => void,
  ) => () => void
  /**
   * 라이브 AI 질의응답(AI-QUESTION-01, `POST /live-sessions/{id}/ai/answers/stream`).
   *
   * **세션 스코프**다 — 레슨이 아니다. ai-api가 자막 근거를 세션 범위로 검증하고, 세션을 경로에 두면
   * `lessonId`를 서버가 세션에서 조회해 채우므로 클라가 다른 강의의 근거를 열람할 여지가 없다(ADR-0047 §1b).
   *
   * 구독형이지만 자막·채팅의 `subscribe*`처럼 unsubscribe를 돌려주지 않고 `AbortSignal`을 받는다 —
   * 이건 상시 연결이 아니라 **한 번의 요청이 여러 이벤트로 답하는** 단발 스트림이고, 전송 수단이
   * `fetch`라 취소 수단도 그쪽 계약(`AbortController`)이 정본이기 때문이다(LIVE.md §10.1 "소비 방법").
   * Promise는 terminal 이벤트를 넘긴 뒤(또는 취소된 뒤) resolve한다.
   *
   * @param question 1~4,000자. 서버가 trim하지 않으므로 **호출자가 trim해서 넘긴다**.
   *                 `contextTimeMs`·`requestId`·`lessonId`는 서버가 채운다(클라가 보내지 않는다).
   */
  askLiveAi: (sessionId: string, question: string, options: AiAnswerStreamOptions) => Promise<void>
  /**
   * 다시보기 AI 질의응답(`POST /lessons/{lessonId}/ai/answers/stream`, ADR-0075).
   *
   * **레슨 스코프**다 — 세션이 아니다. 재생 자산이 세션 하나에서 나오므로 서버가 자산에서
   * `sessionId`·`curriculumId`를 조회한다. 클라가 세션을 고를 수 있으면 수강하지 않은 강의의 근거를
   * 열람할 여지가 생긴다.
   *
   * 이벤트·오류·취소 계약은 {@link LiveSessionService.askLiveAi}와 **같다**. 답변 기록도 같은 표에
   * 쌓여 `getAiAnswerHistory(sessionId)`로 함께 읽힌다.
   *
   * @param playbackSessionMs 질문을 누른 순간의 **세션 상대** 재생 위치. 플레이어 시각이 아니라
   *                          `toSessionMs(mediaTime, source.availableFromMs)` 결과를 넘긴다 —
   *                          미디어 시각을 그대로 보내면 근거 자막이 통째로 어긋난다.
   */
  askReplayAi: (
    lessonId: string,
    question: string,
    playbackSessionMs: number,
    options: AiAnswerStreamOptions,
  ) => Promise<void>
  saveBookmark: (lessonId: string, sessionMs: number) => Promise<void>
  getAiAnswerHistory: (sessionId: string) => Promise<AiAnswerHistoryItem[]>
  /** 내가 이미 쌓은 칸별 재생 횟수. 새로고침 뒤 이어서 세려면 필요하다. */
  getGlossary: (lessonId: string) => Promise<GlossaryTerm[]>
  getMyWatchBuckets: (lessonId: string) => Promise<Record<number, number>>
  reportWatchBuckets: (lessonId: string, counts: Record<number, number>) => Promise<void>
  getWatchHeatmap: (lessonId: string, durationMs: number | null) => Promise<WatchHeatmap>
  getLectureNotes: (sessionId: string) => Promise<LectureNoteView>
  subscribeLectureNotes: (
    sessionId: string,
    onNote: (note: LectureNoteView) => void,
    onConnectionChange: (state: ChatConnectionState) => void,
  ) => () => void
  getProcessingStatus: (sessionId: string) => Promise<ProcessingStatus>
  getQuestionHighlights: (sessionId: string) => Promise<QuestionHighlight[]>
}
