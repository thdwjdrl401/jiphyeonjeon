import { demoLiveCaptions, demoMessages, getDemoLiveSession } from '@/features/demo/demoData'
import { findMockLesson, findMockLiveSession } from '@/features/demo/mockDatabase'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import {
  publishRecordingReady,
  publishVodPublished,
} from '@/features/notification/mockNotificationEvents'
import type {
  AiAnswerHistoryItem,
  AiAnswerSource,
  CaptionStreamEvent,
  ChatConnectionState,
  ChatMessageView,
  GlossaryTerm,
  LectureNoteTopic,
  LectureNoteView,
  LiveSessionService,
  LiveSessionStateEvent,
  LiveSessionView,
} from './liveSessionService.interface'

const liveStatusOverrides = new Map<string, CurriculumLiveSessionStatus>()
const liveStartOperations = new Map<string, string>()
const processingPollCounts = new Map<string, number>()
const stateSubscribers = new Map<string, Set<(event: LiveSessionStateEvent) => void>>()
const mockLivePlaybackUrl = 'https://files.vidstack.io/sprite-fight/hls/stream.m3u8'

/** 상태 전이를 구독자에게 흘린다. 구독자가 없는 세션도 있으므로 조용히 지나간다. */
function notifyState(sessionId: string, event: LiveSessionStateEvent) {
  stateSubscribers.get(sessionId)?.forEach((subscriber) => subscriber(event))
}

/*
 * 개발용 주입 채널(DevLivePanel 전용). 화면이 실제 WS로 받는 것과 같은 콜백을 붙잡아 뒀다가,
 * 개발자가 패널 버튼을 누르면 그 콜백을 직접 불러 "방금 도착한 메시지/자막"을 흉내 낸다.
 * subscribeChatMessages(mine 낙관적 갱신)와는 별개 경로다 — 여기는 "다른 사람이 보낸" 것까지
 * 재현하려는 목적이라 실제 서버가 없어도 병합·스크롤 로직을 눈으로 검증할 수 있다.
 */
interface ChatSubscriber { onMessage: (message: ChatMessageView) => void; onConnectionChange: (state: ChatConnectionState) => void }
interface CaptionSubscriber { onEvent: (event: CaptionStreamEvent) => void; onConnectionChange: (state: ChatConnectionState) => void }
const chatSubscribers = new Map<string, Set<ChatSubscriber>>()
const captionSubscribers = new Map<string, Set<CaptionSubscriber>>()

/*
 * 채팅·노트·AI 기록·용어집의 "탭별 덮어쓰기". 값이 없으면(override 미설정) 항상 있던 데모 내용을
 * 그대로 돌려준다 — 다시보기·녹화강의 등 이 mock을 함께 쓰는 다른 화면은 지금과 똑같이 동작한다.
 * DevLivePanel이 세션에 들어오는 순간 이 세션 것만 비우므로(devReset*), 그 영향은 같은 sessionId/
 * lessonId를 여는 동안으로 좁혀진다.
 */
const chatOverrides = new Map<string, ChatMessageView[]>()
const noteOverrides = new Map<string, LectureNoteView>()
const aiHistoryOverrides = new Map<string, AiAnswerHistoryItem[]>()
const glossaryOverrides = new Map<string, GlossaryTerm[]>()

const defaultLectureNote: LectureNoteView = {
  coveredThroughSequence: 21,
  topics: [
    {
      topicId: 'topic-1',
      title: '요청이 인증되는 전체 흐름',
      keyPoints: [
        'HTTP 요청은 보안 필터 체인을 먼저 통과합니다.',
        '인증 성공 결과는 현재 요청의 보안 컨텍스트에 저장됩니다.',
      ],
    },
    {
      topicId: 'topic-2',
      title: 'SecurityContext의 책임',
      keyPoints: ['SecurityContext는 현재 실행 흐름의 인증 정보를 제공합니다.'],
    },
  ],
  markdown: '## 요청이 인증되는 전체 흐름\n- HTTP 요청은 보안 필터 체인을 먼저 통과합니다.',
  status: 'CAPTURING',
  updatedAt: '2026-08-02T21:00:00+09:00',
}
const emptyLectureNote: LectureNoteView = { coveredThroughSequence: 0, topics: [], markdown: '', status: 'CAPTURING', updatedAt: null }

const defaultAiHistory: AiAnswerHistoryItem[] = [
  {
    requestId: 'req-mock-1',
    question: '세션과 JWT를 함께 쓰는 기준이 뭔가요?',
    answer: '세션은 서버가 상태를 들고, JWT는 토큰 자체가 상태를 나릅니다.',
    sources: '[]',
    status: 'DONE',
    failureCode: null,
    askedAt: '2026-08-02T21:00:00+09:00',
  },
]

// 용어가 많아졌을 때(스크롤·용어 추가 행 위치 등)를 눈으로 확인할 수 있게 목을 넉넉히 채워 둔다.
// 처음 두 개(SecurityContext·SecurityFilterChain)의 termId·정의는 여러 통합 테스트가 문자 그대로
// 단언하므로 값을 바꾸지 않는다 — 새 용어는 뒤에만 더한다.
const defaultGlossaryTerms: GlossaryTerm[] = [
  {
    termId: 'SecurityContext',
    term: 'SecurityContext',
    definition: '현재 요청에서 인증된 사용자와 권한 정보를 보관하는 컨테이너입니다.',
    source: 'MATERIAL',
  },
  {
    termId: 'SecurityFilterChain',
    term: 'SecurityFilterChain',
    definition: '요청에 순서대로 적용할 보안 필터 묶음입니다.',
    source: 'INSTRUCTOR',
  },
  {
    termId: 'AuthenticationManager',
    term: 'AuthenticationManager',
    definition: '실제 인증 로직을 위임받아 수행하는 인터페이스입니다.',
    source: 'MATERIAL',
  },
  {
    termId: 'AccessDecisionManager',
    term: 'AccessDecisionManager',
    definition: '인가(권한) 여부를 최종 판단하는 컴포넌트입니다.',
    source: 'MATERIAL',
  },
  {
    termId: 'CsrfToken',
    term: 'CsrfToken',
    definition: '상태 변경 요청이 실제 화면에서 왔는지 검증하는 값입니다.',
    source: 'INSTRUCTOR',
  },
  {
    termId: 'PasswordEncoder',
    term: 'PasswordEncoder',
    definition: '비밀번호를 저장 전 해시로 변환하고, 로그인 시 원문과 비교 검증하는 컴포넌트입니다.',
    source: 'MATERIAL',
  },
  {
    termId: 'UserDetailsService',
    term: 'UserDetailsService',
    definition: '사용자 식별자로 인증에 필요한 사용자 정보를 조회해 오는 인터페이스입니다.',
    source: 'MATERIAL',
  },
  {
    termId: 'GrantedAuthority',
    term: 'GrantedAuthority',
    definition: '인증된 사용자에게 부여된 권한 하나를 나타내는 값입니다.',
    source: 'MATERIAL',
  },
  {
    termId: 'JwtAuthenticationFilter',
    term: 'JwtAuthenticationFilter',
    definition: '요청 헤더의 JWT를 검증해 SecurityContext에 인증 정보를 채워 넣는 커스텀 필터입니다.',
    source: 'INSTRUCTOR',
  },
  {
    termId: 'RememberMeServices',
    term: 'RememberMeServices',
    definition: '세션이 끊긴 뒤에도 쿠키로 사용자를 다시 인증해 주는 자동 로그인 기능입니다.',
    source: 'MATERIAL',
  },
  {
    termId: 'SessionFixationProtection',
    term: 'SessionFixationProtection',
    definition: '로그인 성공 시 세션 ID를 새로 발급해 세션 고정 공격을 막는 정책입니다.',
    source: 'INSTRUCTOR',
  },
  {
    termId: 'CorsConfigurationSource',
    term: 'CorsConfigurationSource',
    definition: '어떤 출처·메서드·헤더의 교차 출처 요청을 허용할지 정의하는 설정입니다.',
    source: 'MATERIAL',
  },
]

/**
 * 모듈 상태 초기화. 위 Map들은 한 번 쓰이면 프로세스가 끝날 때까지 남는다 — 라이브를 시작하는
 * 테스트가 세션을 LIVE로 바꿔 두면 <b>그 뒤에 도는 다른 테스트</b>가 SCHEDULED를 기대하다 깨진다.
 * 지금까지는 파일 안 테스트 순서가 우연히 맞아 가려져 있었고, 순서를 섞으면 바로 재현됐다.
 * {@code resetMockAuth}가 데모 상태를 되돌릴 때 함께 부른다.
 *
 * <p>종료 상태 구독자(`stateSubscribers`)도 함께 지운다 — 남겨 두면 이전 테스트가 붙여 둔 구독자가
 * 다음 테스트의 이벤트를 받아 엉뚱한 화면 전환을 만든다.
 */
export function resetMockLiveSessions() {
  liveStatusOverrides.clear()
  liveStartOperations.clear()
  processingPollCounts.clear()
  chatSubscribers.clear()
  captionSubscribers.clear()
  stateSubscribers.clear()
  chatOverrides.clear()
  noteOverrides.clear()
  aiHistoryOverrides.clear()
  glossaryOverrides.clear()
}

async function getMockLiveSession(sessionId: string): Promise<LiveSessionView> {
  const session = getDemoLiveSession(sessionId)
  const status = liveStatusOverrides.get(sessionId) ?? session.status
  return {
    ...session,
    status,
    participants: status === 'LIVE' ? Math.max(session.participants, 1) : 0,
    entryWindowMinutes: 10,
  }
}

export const mockLiveSessionService = {
  getLiveSession: getMockLiveSession,
  async getPlayback(lessonId) {
    // 실 API가 레슨의 라이브 세션을 찾아 응답에 싣듯, 목도 데모 데이터에서 세션을 찾는다.
    const liveSession = findMockLesson(lessonId)?.lesson.liveSession
    return {
      lessonId,
      sessionId: liveSession?.sessionId ?? `ses-mock-${lessonId}`,
      liveSessionStatus: liveSession?.status ?? 'LIVE',
      replayStatus: liveSession?.status === 'ENDED' ? 'PUBLISHED' as const : 'DRAFT' as const,
      currentSessionMs: null,
      durationMs: null,
      source: { url: mockLivePlaybackUrl, availableFromMs: 0, availableToMs: null },
    }
  },
  async preparePreflightRoom(sessionId) {
    return { sessionId, roomName: `session-${sessionId}`, roomSid: `RM_${sessionId}` }
  },
  async getPreflightReadiness() {
    return {
      ready: true,
      instructorPresent: true,
      microphonePublished: true,
      microphoneMuted: false,
      instructorMicrophoneTrackCount: 1,
      unexpectedMicrophonePublishers: 0,
    }
  },
  async startLiveSession(sessionId) {
    const operationId = liveStartOperations.get(sessionId) ?? `op-${sessionId}`
    liveStartOperations.set(sessionId, operationId)
    liveStatusOverrides.set(sessionId, 'STARTING')
    // 서버도 STARTING 커밋 후 상태 토픽으로 알린다. 목이 이걸 빠뜨리면 시작 전에 들어와 있던
    // 수강생 화면이 데모에서만 대기 상태에 머문다.
    notifyState(sessionId, {
      type: 'session.starting',
      occurredAt: new Date().toISOString(),
      payload: { liveSessionStatus: 'STARTING', endedAt: null },
    })
    return { operationId, sessionId, status: 'STARTING' as const }
  },
  async getLiveStartStatus(sessionId) {
    const operationId = liveStartOperations.get(sessionId) ?? null
    liveStatusOverrides.set(sessionId, 'LIVE')
    notifyState(sessionId, {
      type: 'session.started',
      occurredAt: new Date().toISOString(),
      payload: { liveSessionStatus: 'LIVE', endedAt: null },
    })
    const demo = getDemoLiveSession(sessionId)
    const session = {
      ...demo,
      status: 'LIVE' as const,
      participants: Math.max(demo.participants, 1),
      entryWindowMinutes: 10,
    }
    return {
      operationId,
      attemptStatus: 'SUCCEEDED' as const,
      step: 'LIVE' as const,
      failureCode: null,
      failureMessage: null,
      session,
    }
  },
  async endLiveSession(sessionId) {
    liveStatusOverrides.set(sessionId, 'ENDING')
    notifyState(sessionId, {
      type: 'session.ending',
      occurredAt: new Date().toISOString(),
      payload: { liveSessionStatus: 'ENDING', endedAt: null },
    })
    liveStatusOverrides.set(sessionId, 'ENDED')
    const endedAt = new Date().toISOString()
    notifyState(sessionId, {
      type: 'session.ended',
      occurredAt: endedAt,
      payload: { liveSessionStatus: 'ENDED', endedAt },
    })
    return getMockLiveSession(sessionId)
  },
  async getInstructorLiveToken(sessionId) {
    return { token: `mock-token-${sessionId}` }
  },
  async getParticipants() {
    return [
      { alias: '수강생-14A2', state: '시청 중', joinedAt: '09:52' },
      { alias: '수강생-09C1', state: 'DVR · 2분 전', joinedAt: '09:55' },
      { alias: '수강생-21B3', state: '시청 중', joinedAt: '10:03' },
    ]
  },
  async getChatMessages(sessionId) {
    return chatOverrides.get(sessionId) ?? demoMessages
  },
  async sendChatMessage(_sessionId, input) {
    // 익명을 켜면 서버가 세션 한정 가명을 붙인다 — 데모도 같은 모양으로 흉내 낸다(ADR-0050·ADR-0023).
    return {
      id: `msg_${Date.now()}`,
      clientMessageId: input.clientMessageId,
      alias: input.anonymous ? '익명1' : '김학생',
      // 익명이면 서버가 사진을 내려보내지 않는다(ADR-0050) — mock도 같은 규칙이어야 화면을 시험할 수 있다.
      avatarUrl: input.anonymous ? null : 'https://i.pravatar.cc/80?img=12',
      text: input.text,
      time: '현재',
      question: input.question,
      mine: true,
    }
  },
  subscribeChatMessages(sessionId, onMessage, onConnectionChange) {
    const subscriber: ChatSubscriber = { onMessage, onConnectionChange }
    const subscribers = chatSubscribers.get(sessionId) ?? new Set()
    subscribers.add(subscriber)
    chatSubscribers.set(sessionId, subscribers)
    onConnectionChange('connected')
    return () => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0) chatSubscribers.delete(sessionId)
      onConnectionChange('disconnected')
    }
  },
  subscribeSessionState(sessionId, onEvent, onConnectionChange) {
    const subscribers = stateSubscribers.get(sessionId) ?? new Set()
    subscribers.add(onEvent)
    stateSubscribers.set(sessionId, subscribers)
    onConnectionChange('connected')
    // 서버도 구독 직후 현재 인원을 한 번 보낸다 — 목이 이걸 빠뜨리면 접속자 수가 목에서만 0이 된다.
    onEvent({
      type: 'session.presence',
      occurredAt: new Date().toISOString(),
      payload: { participantCount: getDemoLiveSession(sessionId).participants },
    })
    return () => {
      subscribers.delete(onEvent)
      if (subscribers.size === 0) stateSubscribers.delete(sessionId)
      onConnectionChange('disconnected')
    }
  },
  subscribeCaptions(sessionId, onEvent, onConnectionChange) {
    const subscriber: CaptionSubscriber = { onEvent, onConnectionChange }
    const subscribers = captionSubscribers.get(sessionId) ?? new Set()
    subscribers.add(subscriber)
    captionSubscribers.set(sessionId, subscribers)
    onConnectionChange('connected')
    // 데모 자막을 델타 + 확정 세그먼트 스트림으로 흉내 낸다: 각 데모 라인을 한 sttSession으로 흘리되,
    // 델타(진행 중) 뒤에 caption.segment.final(권위 있는 확정 텍스트)로 마감한다. 마지막 라인은 세그먼트·
    // completed 없이 델타만 남겨 "진행 중(pending)" 라이브 조각을 보여 준다.
    const occurredAt = new Date().toISOString()
    demoLiveCaptions.forEach((caption, index) => {
      onEvent({
        type: 'caption.delta',
        occurredAt,
        // 데모 startMs는 세션 축(12:08=728s)이라 sessionMs로도 실어 진행 중 조각의 위치 동기화가 동작하게 한다.
        payload: { sttSessionId: `mock-stt-${index}`, sequence: 1, streamElapsedMs: caption.startMs, sessionMs: caption.startMs, text: caption.text },
      })
      if (index < demoLiveCaptions.length - 1) {
        onEvent({
          type: 'caption.segment.final',
          occurredAt,
          payload: {
            sttSessionId: `mock-stt-${index}`,
            segmentIndex: 0,
            lastSequence: 1,
            text: caption.text,
            startStreamElapsedMs: caption.startMs,
            endStreamElapsedMs: caption.endMs,
            boundaryReason: 'SILENCE',
            sessionMs: caption.startMs,
          },
        })
        onEvent({
          type: 'caption.stream.completed',
          occurredAt,
          payload: { sttSessionId: `mock-stt-${index}`, lastSequence: 1, reason: 'ROOM_DELETED' },
        })
      }
    })
    return () => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0) captionSubscribers.delete(sessionId)
      onConnectionChange('disconnected')
    }
  },
  async getCaptions() {
    // 리로드는 WS와 같은 스트림 이벤트로 시드된다. sttSessionId·sequence·segmentIndex를 subscribeCaptions와
    // 동일하게 둬 실제 BE처럼 WS 이벤트와 멱등 병합되게 한다(중복 라인 방지). 확정 라인은 segment.final로,
    // 마지막 진행 중 라인은 델타로만 시드한다.
    const occurredAt = new Date().toISOString()
    return demoLiveCaptions.flatMap((caption, index) => {
      const delta = {
        type: 'caption.delta' as const,
        occurredAt,
        payload: {
          sttSessionId: `mock-stt-${index}`,
          sequence: 1,
          streamElapsedMs: caption.startMs,
          sessionMs: caption.startMs,
          text: caption.text,
        },
      }
      if (index === demoLiveCaptions.length - 1) return [delta]
      return [
        delta,
        {
          type: 'caption.segment.final' as const,
          occurredAt,
          payload: {
            sttSessionId: `mock-stt-${index}`,
            segmentIndex: 0,
            lastSequence: 1,
            text: caption.text,
            startStreamElapsedMs: caption.startMs,
            endStreamElapsedMs: caption.endMs,
            boundaryReason: 'SILENCE' as const,
            sessionMs: caption.startMs,
          },
        },
      ]
    })
  },
  // 목도 스트리밍 UX를 그대로 재현한다 — 델타를 조각내 흘린 뒤 근거를 실은 answer.done으로 끝낸다.
  // 한 번에 완성 문장을 주면 "누적 렌더·전송 중 비활성·취소"가 목 모드에서 아예 검증되지 않는다.
  // 근거 없는 질문은 answer.insufficient로 끝내 오류가 아닌 별도 상태도 화면에서 볼 수 있게 한다.
  async askLiveAi(sessionId, question, { onEvent, signal }) {
    const requestId = `req-mock-${Date.now()}`
    const insufficient = question.includes('점심')
    const chunks = insufficient
      ? []
      : [
          'SecurityContext는 인증이 끝난 현재 요청의 사용자 정보를 보관합니다. ',
          '세션 저장소와는 책임이 다르며, ',
          '요청이 끝나면 컨텍스트가 정리됩니다.',
        ]

    for (const text of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (signal?.aborted) return
      onEvent({ type: 'answer.delta', payload: { requestId, text } })
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
    if (signal?.aborted) return

    if (insufficient) {
      onEvent({
        type: 'answer.insufficient',
        payload: { requestId, message: '이 질문에 답할 근거를 강의 자료와 발화에서 찾지 못했습니다.' },
      })
      return
    }

    onEvent({
      type: 'answer.done',
      payload: {
        requestId,
        sources: [
          {
            type: 'PPTX',
            materialId: 'mat-session-and-csrf',
            page: 12,
            excerpt: '세션과 CSRF\n쿠키 세션은 브라우저가 자동으로 실어 보내므로, 위조 요청도 인증을 통과한다.\n그래서 상태를 바꾸는 요청에는 CSRF 토큰을 함께 요구한다.',
          },
          // CAPTION의 시각은 STT attempt-local 축이다(세션-ms 아님) — 목도 같은 축으로 준다.
          { type: 'CAPTION', sessionId, sttSessionId: 'stt-mock-1', startMs: 728_000, endMs: 761_000 },
        ],
      },
    })
  },
  // 다시보기 질문(ADR-0075). 라이브와 이벤트 흐름이 같고, 근거가 **질문한 시점 주변**이라는 것만
  // 다르다 — 목도 받은 재생 위치를 근거 시각에 반영해 "여기서 말한 내용"이 도는지 눈으로 보게 한다.
  async askReplayAi(_lessonId, question, playbackSessionMs, { onEvent, signal }) {
    const requestId = `req-mock-replay-${Date.now()}`
    const chunks = [
      '방금 지점에서 설명한 내용은 ',
      '인증 상태를 요청 사이에 유지하는 세션과, ',
      '현재 요청의 인증 주체를 담는 SecurityContext의 차이입니다.',
    ]

    for (const text of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (signal?.aborted) return
      onEvent({ type: 'answer.delta', payload: { requestId, text } })
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
    if (signal?.aborted) return

    if (question.includes('점심')) {
      onEvent({
        type: 'answer.insufficient',
        payload: { requestId, message: '이 질문에 답할 근거를 강의 자료와 발화에서 찾지 못했습니다.' },
      })
      return
    }

    onEvent({
      type: 'answer.done',
      payload: {
        requestId,
        sources: [
          {
            type: 'PPTX',
            materialId: 'mat-session-and-csrf',
            page: 12,
            excerpt: '세션과 CSRF\n쿠키 세션은 브라우저가 자동으로 실어 보낸다.',
          },
          {
            type: 'CAPTION',
            sessionId: 'ses-replay-mock',
            sttSessionId: 'replay:ses-replay-mock',
            // v2 근거는 플레이어와 같은 축이다(라이브 v1의 attempt-local과 다르다) — 눌러서 이동한다.
            startMs: Math.max(0, playbackSessionMs - 12_000),
            endMs: playbackSessionMs,
            excerpt: '세션은 인증 상태를 여러 요청에 걸쳐 유지합니다.',
            timeAxis: 'PLAYBACK',
          },
        ],
      },
    })
  },
  async getAiAnswerHistory(sessionId) {
    // 목도 서버와 같은 모양을 돌려준다 — 목이 다르면 실서버에서만 깨지는 화면이 된다.
    return aiHistoryOverrides.get(sessionId) ?? defaultAiHistory
  },
  async getGlossary(lessonId) {
    return glossaryOverrides.get(lessonId) ?? defaultGlossaryTerms
  },
  async upsertGlossaryTerm(lessonId, term, definition) {
    const trimmedTerm = term.trim()
    const current = glossaryOverrides.get(lessonId) ?? defaultGlossaryTerms
    const existingIndex = current.findIndex((entry) => entry.term === trimmedTerm)
    const updated: GlossaryTerm = {
      termId: trimmedTerm,
      term: trimmedTerm,
      definition: definition.trim(),
      source: 'INSTRUCTOR',
    }
    const next = existingIndex >= 0
      ? current.map((entry, index) => index === existingIndex ? updated : entry)
      : [...current, updated]
    glossaryOverrides.set(lessonId, next)
    return updated
  },
  async getMyWatchBuckets() {
    return { 0: 1, 1: 1, 2: 3, 3: 1 }
  },
  async reportWatchBuckets() {
    // 목은 저장하지 않는다 — 화면이 전송 실패로 흔들리지 않게 조용히 성공한다.
  },
  async getWatchHeatmap() {
    // 서버와 같은 모양. 2.4가 가장 많이 다시 본 구간이다.
    return {
      bucketSizeMs: 10000,
      points: [1, 1, 1.2, 2.4, 1.8, 1, 1, 1.1, 1, 1],
      viewers: 5,
    }
  },
  async getLectureNotes(sessionId) {
    // 목도 서버와 같은 모양을 돌려준다 — 목이 다르면 실서버에서만 깨지는 화면이 된다.
    return noteOverrides.get(sessionId) ?? defaultLectureNote
  },
  subscribeGlossaryUpdates() {
    // 목에서는 용어집이 바뀌지 않는다. 구독 해제만 제대로 돌려준다.
    return () => {}
  },
  subscribeLectureNotes(_sessionId, _onNote, onConnectionChange) {
    onConnectionChange('connected')
    return () => onConnectionChange('disconnected')
  },
  async getProcessingStatus(sessionId) {
    // 서버와 같은 모양으로 돌려준다 — 목이 화면 문구를 만들어 주면 실서버에서만 깨지는 화면이 된다.
    const pollCount = (processingPollCounts.get(sessionId) ?? 0) + 1
    processingPollCounts.set(sessionId, pollCount)
    const ready = pollCount >= 2
    if (ready) {
      /*
        녹화가 READY로 넘어가는 순간이 알림의 방아쇠다. 서버에서는 Egress COMPLETE webhook이
        같은 자리에 있고, 그 webhook은 재전송될 수 있다 — 여기서도 폴링마다 다시 들어오지만
        중복 방지 키가 같아 알림은 한 건만 남는다.

        학생용 다시보기 알림을 함께 만드는 이유: 현재 서버는 새 정상 녹화를 READY와 동시에
        게시한다(`RecordingService.markReady`가 DRAFT → PUBLISHED). 즉 이 시점이 "학생에게
        공개된" 시점이기도 하다. 강사 검수 후 게시로 흐름이 바뀌면 이 줄을 지우고
        `publishReplayReview`만 남기면 된다.
      */
      publishRecordingReady(sessionId)
      const found = findMockLiveSession(sessionId)
      // 목차상 실제로 공개된 다시보기만 알린다 — 미게시·철회 자산은 학생 알림을 만들지 않는다.
      if (found?.lesson.replayStatus === 'PUBLISHED') publishVodPublished(found.lesson.lessonId)
    }
    return {
      sessionId,
      liveSessionStatus: 'ENDED' as const,
      recordingEnabled: true,
      startedAt: '2026-08-01T10:00:00+09:00',
      endedAt: '2026-08-01T11:32:00+09:00',
      videoAsset: {
        videoAssetId: 'vid_mock_0001',
        status: ready ? 'READY' as const : 'FINALIZING' as const,
        replayStatus: ready ? 'PUBLISHED' as const : 'DRAFT' as const,
        failureCode: null,
        durationMs: ready ? 5_520_000 : null,
        sizeBytes: ready ? 1_284_000_000 : null,
        recordingStartedAt: '2026-08-01T10:00:04+09:00',
        recordingEndedAt: '2026-08-01T11:32:06+09:00',
      },
    }
  },
  async getQuestionHighlights() {
    return [
      { at: '12:18', count: 3, text: '세션과 JWT를 함께 사용하는 기준이 궁금해요.' },
      { at: '27:40', count: 5, text: '필터 순서가 실제 인증에 어떤 영향을 주나요?' },
      { at: '41:05', count: 2, text: 'Redis 장애 시 세션 복구 방식이 궁금해요.' },
    ]
  },
} satisfies LiveSessionService

/*
 * 아래는 DevLivePanel(개발 전용 화면 안 조작 패널) 전용 API다. LiveSessionService 계약에는 없다 —
 * 실 서버엔 대응하는 게 없는, 목 상태를 직접 흔드는 손잡이이기 때문이다. 프로덕션 빌드에는
 * DevLivePanel 자체가 안 실리므로(‎import.meta.env.DEV) 이 함수들도 호출되지 않는다.
 */

/** 다른 수강생·강사가 방금 보낸 것처럼 채팅 한 줄을 흘린다. subscribeChatMessages 구독자 전원이 받는다. */
export function devPushChatMessage(sessionId: string, input: { text: string; alias?: string; mine?: boolean; question?: boolean; avatarUrl?: string | null }) {
  const message: ChatMessageView = {
    id: `msg_dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    alias: input.alias ?? (input.mine ? '김학생' : '익명2'),
    avatarUrl: input.avatarUrl ?? null,
    text: input.text,
    time: new Date().toLocaleTimeString('ko-KR'),
    question: input.question,
    mine: input.mine,
  }
  chatSubscribers.get(sessionId)?.forEach(({ onMessage }) => onMessage(message))
}

/** 채팅 WS 연결 상태를 강제로 바꾼다 — 재연결 배너·안내 문구를 실제 끊김 없이 확인할 때 쓴다. */
export function devSetChatConnectionState(sessionId: string, state: ChatConnectionState) {
  chatSubscribers.get(sessionId)?.forEach(({ onConnectionChange }) => onConnectionChange(state))
}

/** 자막 한 줄을 델타+확정 세그먼트로 흘린다 — 실제 STT 스트림과 같은 두 이벤트 순서를 낸다. */
export function devPushCaptionLine(sessionId: string, text: string) {
  const occurredAt = new Date().toISOString()
  const sttSessionId = `dev-stt-${Date.now()}`
  captionSubscribers.get(sessionId)?.forEach(({ onEvent }) => {
    onEvent({ type: 'caption.delta', occurredAt, payload: { sttSessionId, sequence: 1, streamElapsedMs: 0, sessionMs: null, text } })
    onEvent({
      type: 'caption.segment.final',
      occurredAt,
      payload: { sttSessionId, segmentIndex: 0, lastSequence: 1, text, startStreamElapsedMs: 0, endStreamElapsedMs: 0, boundaryReason: 'SILENCE', sessionMs: null },
    })
  })
}

/** 자막 WS 연결 상태를 강제로 바꾼다. */
export function devSetCaptionConnectionState(sessionId: string, state: ChatConnectionState) {
  captionSubscribers.get(sessionId)?.forEach(({ onConnectionChange }) => onConnectionChange(state))
}

/**
 * 세션 상태를 즉시 덮어쓴다. subscribeSessionState는 타입이 ENDING/ENDED/presence로 좁혀 있어
 * LIVE·STARTING 같은 임의 상태를 그 경로로 흘릴 수 없다 — 이후 조회(getLiveSession, WS 재연결 시
 * invalidate)가 이 값을 읽도록 override만 남겨 둔다. 화면 갱신은 DevLivePanel이 QueryClient를 직접
 * 건드려 즉시 반영한다.
 */
export function devSetLiveSessionStatusOverride(sessionId: string, status: CurriculumLiveSessionStatus) {
  liveStatusOverrides.set(sessionId, status)
}

/** 접속자 수를 강제로 바꾼다 — session.presence는 타입이 이미 넓어 실제 WS 경로 그대로 흘릴 수 있다. */
export function devSetParticipantCount(sessionId: string, participantCount: number) {
  stateSubscribers.get(sessionId)?.forEach((subscriber) => subscriber({
    type: 'session.presence',
    occurredAt: new Date().toISOString(),
    payload: { participantCount },
  }))
}

/*
 * 탭별 초기화/샘플 데이터 주입. REST 조회 하나뿐인 값들이라(WS로 흘릴 필요 없이) override만
 * 바꿔 두면 된다 — DevLivePanel이 바로 뒤에 해당 쿼리를 invalidate해서 화면에 반영한다.
 *
 * "추가"는 매번 새로 쌓는다(덮어쓰지 않는다) — 스크롤이 생길 만큼 넣으려면 한 번 누르고 끝나면
 * 안 된다. id는 호출마다 새로 만든다 — 같은 id를 반복해 넣으면 React key가 겹쳐 목록이 화면에서
 * 갱신되지 않는다. 내용은 실제 이 mock이 돌려주던 데모 문장 풀에서 순서대로 고른다 — 매번 같은
 * 한 줄이 아니라 "실제로 있을 법한" 여러 줄을 확인할 수 있게.
 */
function devUniqueId(base: string) {
  return `${base}-dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function devResetChat(sessionId: string) {
  chatOverrides.set(sessionId, [])
}
export function devAppendChatSample(sessionId: string) {
  const current = chatOverrides.get(sessionId) ?? []
  const additions = demoMessages.map((message) => ({ ...message, id: devUniqueId(message.id) }))
  chatOverrides.set(sessionId, [...current, ...additions])
}

export function devResetLectureNote(sessionId: string) {
  noteOverrides.set(sessionId, emptyLectureNote)
}
const lectureNoteTopicPool: LectureNoteTopic[] = [
  { title: '요청이 인증되는 전체 흐름', keyPoints: ['HTTP 요청은 보안 필터 체인을 먼저 통과합니다.', '인증 성공 결과는 현재 요청의 보안 컨텍스트에 저장됩니다.'] },
  { title: 'SecurityContext의 책임', keyPoints: ['SecurityContext는 현재 실행 흐름의 인증 정보를 제공합니다.'] },
  { title: 'SecurityFilterChain 구성', keyPoints: ['필터는 등록 순서대로 실행됩니다.', '커스텀 필터는 특정 필터 앞뒤에 끼워 넣을 수 있습니다.'] },
  { title: '세션과 JWT의 차이', keyPoints: ['세션은 서버가 상태를 보관합니다.', 'JWT는 토큰 자체가 상태를 담아 무상태로 검증합니다.'] },
  { title: 'CSRF와 세션 쿠키', keyPoints: ['쿠키 세션은 브라우저가 자동으로 실어 보냅니다.', '상태를 바꾸는 요청에는 CSRF 토큰을 함께 요구합니다.'] },
]
export function devAppendLectureNoteSample(sessionId: string) {
  const current = noteOverrides.get(sessionId) ?? emptyLectureNote
  const picked = lectureNoteTopicPool[current.topics.length % lectureNoteTopicPool.length]
  const topic: LectureNoteTopic = { topicId: devUniqueId('topic'), title: picked.title, keyPoints: picked.keyPoints }
  const markdownSection = `## ${topic.title}\n${topic.keyPoints.map((point) => `- ${point}`).join('\n')}`
  noteOverrides.set(sessionId, {
    coveredThroughSequence: current.coveredThroughSequence + 5,
    topics: [...current.topics, topic],
    markdown: current.markdown ? `${current.markdown}\n\n${markdownSection}` : markdownSection,
    status: 'CAPTURING',
    updatedAt: new Date().toISOString(),
  })
}

export function devResetAiHistory(sessionId: string) {
  aiHistoryOverrides.set(sessionId, [])
}
/*
 * 근거(sources)까지 채운다 — 비워 두면 "근거 n" 토글이 아예 안 그려져(AiEvidenceList가 빈 목록에는
 * 토글을 두지 않는다) 그 UI를 개발 도구로 볼 방법이 없었다.
 *
 * <p><b>라이브(v1) 규약을 따른다.</b> CAPTION 근거에 `timeAxis`를 주지 않는다 — 라이브 자막 근거는
 * STT attempt-local 축이라 눌러서 이동할 좌표가 아니고(ADR-0043·0045·0047), 화면도 그 경우에만
 * "이동을 제공하지 않습니다" 안내를 붙인다. 여기서 PLAYBACK을 주면 라이브에 없는 이동 버튼이 생겨
 * 실제와 다른 화면을 보게 된다.
 *
 * <p>모양을 일부러 섞었다 — 근거 1개/2개/3개, 발췌문이 긴 것, 발췌문이 아예 없는 것(계약상 선택
 * 필드라 옛 답변에는 없다). 한 종류만 두면 잘림·툴팁·빈 발췌 경로가 검증되지 않는다.
 */
const aiHistoryPool: Array<Pick<AiAnswerHistoryItem, 'question' | 'answer'> & {
  /** CAPTION 근거는 sessionId를 함께 실어야 계약을 만족한다 — 넣는 시점에 채운다. */
  buildSources: (sessionId: string) => AiAnswerSource[]
}> = [
  {
    question: '세션과 JWT를 함께 쓰는 기준이 뭔가요?',
    answer: '세션은 서버가 상태를 들고, JWT는 토큰 자체가 상태를 나릅니다.',
    buildSources: (sessionId) => [
      {
        type: 'PPTX',
        materialId: 'mat-session-and-jwt',
        page: 5,
        excerpt: '세션과 JWT\n세션은 서버가 상태를 보관하고, JWT는 토큰 자체가 상태를 담아 무상태로 검증한다.',
      },
      {
        type: 'CAPTION',
        sessionId,
        sttSessionId: 'stt-mock-1',
        startMs: 728_000,
        endMs: 761_000,
        excerpt: '인증이 끝난 뒤에는 SecurityContext가 현재 요청의 사용자 정보를 보관합니다.',
      },
    ],
  },
  {
    question: 'SecurityFilterChain은 왜 순서가 중요한가요?',
    answer: '앞선 필터의 인증 결과를 뒤 필터가 그대로 신뢰하기 때문에, 순서가 바뀌면 인가 판단이 틀어집니다.',
    buildSources: (sessionId) => [
      {
        type: 'PPTX',
        materialId: 'mat-filter-chain',
        page: 7,
        excerpt: '필터 체인 구성\n필터는 등록 순서대로 실행되며, 커스텀 필터는 특정 필터 앞뒤에 끼워 넣을 수 있다.',
      },
      {
        type: 'PPTX',
        materialId: 'mat-filter-chain',
        page: 8,
        excerpt: '인증 필터가 SecurityContext를 채운 뒤에야 인가 필터가 권한을 판단할 수 있다.',
      },
      {
        type: 'CAPTION',
        sessionId,
        sttSessionId: 'stt-mock-2',
        startMs: 902_000,
        endMs: 934_000,
        excerpt: '이 경계를 SecurityFilterChain의 권한 검사와 함께 보겠습니다.',
      },
    ],
  },
  {
    question: 'CSRF 토큰은 왜 세션 쿠키만으로는 부족한가요?',
    answer: '쿠키는 브라우저가 자동으로 실어 보내 위조 요청도 인증을 통과하기 때문에, 별도 토큰으로 요청의 출처를 확인해야 합니다.',
    buildSources: () => [
      {
        type: 'PPTX',
        materialId: 'mat-session-and-csrf',
        page: 12,
        excerpt: '세션과 CSRF\n쿠키 세션은 브라우저가 자동으로 실어 보내므로, 위조 요청도 인증을 통과한다.\n그래서 상태를 바꾸는 요청에는 CSRF 토큰을 함께 요구하고, 서버는 그 값이 방금 내려준 화면에서 온 것인지 대조한다.',
      },
    ],
  },
  {
    question: 'Redis 세션 저장소에 장애가 나면 어떻게 되나요?',
    answer: '세션 조회가 실패해 인증되지 않은 요청으로 처리되고, 다시 로그인해야 합니다.',
    // 발췌문 없는 근거 — 계약상 선택 필드라 옛 답변에는 없다. 그때 시각만 남는지 확인한다.
    buildSources: (sessionId) => [
      { type: 'CAPTION', sessionId, sttSessionId: 'stt-mock-3', startMs: 1_884_000, endMs: 1_902_000 },
    ],
  },
]
export function devAppendAiHistorySample(sessionId: string) {
  const current = aiHistoryOverrides.get(sessionId) ?? []
  const picked = aiHistoryPool[current.length % aiHistoryPool.length]
  const item: AiAnswerHistoryItem = {
    requestId: devUniqueId('req'),
    question: picked.question,
    answer: picked.answer,
    // 계약상 sources는 서버가 해석하지 않는 JSON 문자열이다 — 화면이 이걸 직접 파싱한다.
    sources: JSON.stringify(picked.buildSources(sessionId)),
    status: 'DONE',
    failureCode: null,
    askedAt: new Date().toISOString(),
  }
  aiHistoryOverrides.set(sessionId, [...current, item])
}

export function devResetGlossary(lessonId: string) {
  glossaryOverrides.set(lessonId, [])
}
const glossaryPool: Array<Pick<GlossaryTerm, 'term' | 'definition' | 'source'>> = [
  { term: 'SecurityContext', definition: '현재 요청에서 인증된 사용자와 권한 정보를 보관하는 컨테이너입니다.', source: 'MATERIAL' },
  { term: 'SecurityFilterChain', definition: '요청에 순서대로 적용할 보안 필터 묶음입니다.', source: 'INSTRUCTOR' },
  { term: 'AuthenticationManager', definition: '실제 인증 로직을 위임받아 수행하는 인터페이스입니다.', source: 'MATERIAL' },
  { term: 'AccessDecisionManager', definition: '인가(권한) 여부를 최종 판단하는 컴포넌트입니다.', source: 'MATERIAL' },
  { term: 'CsrfToken', definition: '상태 변경 요청이 실제 화면에서 왔는지 검증하는 값입니다.', source: 'INSTRUCTOR' },
]
export function devAppendGlossarySample(lessonId: string) {
  const current = glossaryOverrides.get(lessonId) ?? []
  const picked = glossaryPool[current.length % glossaryPool.length]
  const term: GlossaryTerm = { termId: devUniqueId(picked.term), term: picked.term, definition: picked.definition, source: picked.source }
  glossaryOverrides.set(lessonId, [...current, term])
}
