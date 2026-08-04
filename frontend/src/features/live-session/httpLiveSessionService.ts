import { Client, type IMessage } from '@stomp/stompjs'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import { ApiError, apiClient, invalidateCsrfToken, resolveCsrfHeader } from '@/shared/api/client'
import { streamLessonAiAnswer } from '@/features/ai/lessonAiAnswerStream'
import { notImplemented } from '@/shared/api/notImplemented'
import { createSseDecoder, type SseFrame } from '@/shared/api/sse'
import { isNetworkBlocked } from '@/shared/config/runtime'
import type {
  AiAnswerSource,
  AiAnswerStreamEvent,
  AiAnswerStreamOptions,
  CaptionSegmentFinalPayload,
  CaptionStreamEvent,
  ChatMessageView,
  LiveStartOperation,
  LiveStartStatus,
  LiveSessionService,
  LiveSessionStateEvent,
  LiveSessionView,
  PreflightReadiness,
  PreflightRoom,
  PlaybackView,
  ProcessingStatus,
  ReplayStatus,
  LectureNoteView,
  LectureNoteTopic,
  AiAnswerHistoryItem,
  WatchHeatmap,
  GlossaryTerm,
} from './liveSessionService.interface'

interface ApiLiveSessionView {
  sessionId: string
  lessonId: string
  liveSessionStatus: string
  scheduledAt: string | null
  entryWindowMinutes: number | null
  expectedDurationMinutes: number | null
  /** 조회 시점의 접속 수강생 수(ADR-0060). 이후 변화는 state 토픽의 session.presence로 온다. */
  participantCount?: number
}

interface ApiChatMessage {
  messageId: string
  clientMessageId?: string
  alias: string
  text: string
  createdAt?: string
  /** 세션 상대 시각(ms). REST·WS 양쪽이 준다 — 다시보기에서 영상 위치와 맞추는 좌표다. */
  sessionMs?: number | null
  isQuestion: boolean
  /**
   * 요청자 본인이 보낸 메시지 여부. REST(전송 응답·복구 조회)에만 있고 WS 브로드캐스트 payload에는 없다 —
   * 토픽 브로드캐스트는 뷰어별이 될 수 없기 때문이다(ChatMessagePayload 계약).
   */
  mine?: boolean
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

/** 확정 세그먼트 경계 payload(camelCase, raw ms 그대로). caption.segment.final. */
interface ApiCaptionSegmentPayload {
  sttSessionId: string
  segmentIndex: number
  lastSequence: number
  text: string
  startStreamElapsedMs: number
  endStreamElapsedMs: number
  boundaryReason: 'SILENCE' | 'MAX_DURATION' | 'STREAM_END'
  sessionMs: number | null
}

/** 리로드 응답 한 줄(WS payload와 정합, type으로 delta/segment.final/completed 구분). CAPTION-01 / ADR-0045. */
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
  /** segment.final 전용(그 외 type이면 null). */
  segmentIndex: number | null
  startStreamElapsedMs: number | null
  endStreamElapsedMs: number | null
  boundaryReason: string | null
}

/** 스트림이 시작되기 **전** 실패의 오류 봉투(ADR-0047 §8 — SSE Accept여도 application/json으로 온다). */
interface ApiErrorEnvelope {
  code?: string
  message?: string
  fieldErrors?: Array<{ field: string; code: string }>
  correlationId?: string
}

interface ApiCaptionEnvelope {
  type: string
  sessionId: string
  occurredAt: string
  payload: unknown
}

interface ApiSessionStateEnvelope {
  type: string
  sessionId: string
  occurredAt: string
  payload: {
    liveSessionStatus?: string
    endedAt?: string | null
    participantCount?: number
  }
}

/** 노트 조회·WS payload는 같은 필드다. topics는 서버가 해석하지 않는 JSON **문자열**로 온다. */
interface ApiLectureNote {
  coveredThroughSequence: number
  topics: string
  markdown: string
  status: string
  updatedAt: string | null
}

/**
 * `topics`를 파싱한다. 서버가 해석하지 않고 옮기기만 하는 값이라 여기서 처음 구조를 본다 —
 * 형식이 어긋나면 화면을 깨뜨리는 대신 빈 목록으로 떨어진다(노트는 부가 정보이고 강의를 막지 않는다).
 */
function parseLectureNote(data: ApiLectureNote): LectureNoteView {
  let topics: LectureNoteTopic[] = []
  try {
    const parsed: unknown = JSON.parse(data.topics || '[]')
    if (Array.isArray(parsed)) {
      topics = parsed.filter((topic): topic is LectureNoteTopic =>
        Boolean(topic) && typeof (topic as LectureNoteTopic).title === 'string'
        && Array.isArray((topic as LectureNoteTopic).keyPoints))
    }
  } catch {
    topics = []
  }
  const status = data.status === 'COMPLETED' || data.status === 'REFINED' ? data.status : 'CAPTURING'
  return {
    coveredThroughSequence: data.coveredThroughSequence ?? 0,
    topics,
    markdown: data.markdown ?? '',
    status,
    updatedAt: data.updatedAt ?? null,
  }
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
  replayStatus: ReplayStatus
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
  if (
    data.lessonId !== lessonId
    || (data.source && !url)
    || !data.liveSessionStatus
    || !REPLAY_STATUSES.includes(data.replayStatus)
  ) {
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
    replayStatus: data.replayStatus,
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

const REPLAY_STATUSES: ReplayStatus[] = [
  'DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED', 'WITHDRAWN',
]

/**
 * 세션이 속한 레슨의 커리큘럼 맥락. 세션 응답에는 없다 — live 모듈은 커리큘럼을 참조하지 않으므로
 * (모듈 경계) 레슨 조회로 채운다. 실패하면 null이고 세션은 맥락 없이 열린다(아래 fetch 주석 참고).
 */
interface LessonCurriculumContext {
  lessonTitle: string
  curriculumId: string
  curriculumTitle: string
  sectionId: string
  sectionTitle: string
}

interface ApiLessonCurriculumContext {
  sectionId: string
  sectionTitle: string
  curriculumId: string
  curriculumTitle: string
  title: string
}

/**
 * lessonId로 커리큘럼 맥락을 읽는다. 역할을 가리지 않고 `GET /lessons/{id}` 하나만 쓴다.
 *
 * 강사에게도 이 경로가 열린다 — `CatalogService.lessonDetail`은 OWNER_INSTRUCTOR와 ENROLLED를
 * 모두 통과시키고, 미게시(DRAFT) 레슨을 막는 게이트는 **ENROLLED에만** 걸린다. 소유 강사 판정도
 * `curriculum.instructorId == viewer`뿐이라 커리큘럼이 DRAFT여도 상관없다
 * (계약 테스트 `StudentLessonContractTest.owner_instructor_can_open_own_unpublished_lesson`).
 * 그래서 강사 엔드포인트를 따로 타거나 BE에 필드를 더할 이유가 없다.
 *
 * 실패를 삼키는 이유: 이 맥락은 사이드바·제목용 부가 정보다. 마이크 점검과 라이브 입장이라는
 * 필수 흐름을 제목 조회 하나가 막으면 안 된다. 못 채우면 사이드바가 기본 메뉴로 내려간다.
 */
async function fetchLessonCurriculumContext(lessonId: string): Promise<LessonCurriculumContext | null> {
  try {
    const { data } = await apiClient.get<ApiLessonCurriculumContext>(`/lessons/${lessonId}`)
    return {
      lessonTitle: data.title,
      curriculumId: data.curriculumId,
      curriculumTitle: data.curriculumTitle,
      sectionId: data.sectionId,
      sectionTitle: data.sectionTitle,
    }
  } catch {
    return null
  }
}

function normalizeLiveSession(
  data: ApiLiveSessionView,
  context: LessonCurriculumContext | null,
): LiveSessionView {
  const entryWindowMinutes = data.entryWindowMinutes ?? 10
  const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null
  return {
    sessionId: data.sessionId,
    lessonId: data.lessonId,
    lessonTitle: context?.lessonTitle ?? '',
    curriculumId: context?.curriculumId ?? '',
    curriculumTitle: context?.curriculumTitle ?? '',
    sectionId: context?.sectionId ?? '',
    sectionTitle: context?.sectionTitle ?? '',
    status: data.liveSessionStatus as CurriculumLiveSessionStatus,
    scheduledAt: data.scheduledAt,
    entryOpensAt: scheduledAt
      ? new Date(scheduledAt.getTime() - entryWindowMinutes * 60_000).toISOString()
      : null,
    entryWindowMinutes,
    expectedDurationMinutes: data.expectedDurationMinutes ?? 0,
    /*
     * 접속 수강생 수(ADR-0060). LiveKit 방 참여자가 아니라 세션 토픽 구독을 사람 단위로 센 값이다 —
     * 수강생은 LiveKit 방에 들어오지 않는다(ADR-0032). 여기서는 조회 시점의 초기값만 받고,
     * 이후 변화는 session.presence 이벤트가 갱신한다.
     */
    participants: data.participantCount ?? 0,
  }
}

function normalizeMessage(message: ApiChatMessage): ChatMessageView {
  return {
    id: message.messageId,
    clientMessageId: message.clientMessageId,
    alias: message.alias,
    text: message.text,
    time: message.createdAt ? new Date(message.createdAt).toLocaleTimeString('ko-KR') : '-',
    /*
     * 벽시계 문자열(time)과 <b>따로</b> 싣는다. 다시보기가 되감기와 맞추려면 사람이 읽을 시각이
     * 아니라 세션 축 좌표가 있어야 한다 — 한때 여기서 버려서 채팅만 시간 동기화를 못 했다.
     */
    sessionMs: message.sessionMs ?? null,
    question: message.isQuestion,
    // WS 에코엔 mine이 없다 — 그때는 화면이 자기 clientMessageId 대조로 채운다(undefined를 false로 굳히지 않는다).
    mine: message.mine,
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

function readSessionStateEnvelope(frame: IMessage, sessionId: string): LiveSessionStateEvent | null {
  const envelope = JSON.parse(frame.body) as ApiSessionStateEnvelope
  if (envelope.sessionId !== sessionId) return null
  if (envelope.type === 'session.ending' && envelope.payload.liveSessionStatus === 'ENDING') {
    return {
      type: 'session.ending',
      occurredAt: envelope.occurredAt,
      payload: { liveSessionStatus: 'ENDING', endedAt: null },
    }
  }
  if (
    envelope.type === 'session.ended'
    && envelope.payload.liveSessionStatus === 'ENDED'
    && typeof envelope.payload.endedAt === 'string'
  ) {
    return {
      type: 'session.ended',
      occurredAt: envelope.occurredAt,
      payload: { liveSessionStatus: 'ENDED', endedAt: envelope.payload.endedAt },
    }
  }
  if (envelope.type === 'session.presence' && typeof envelope.payload.participantCount === 'number') {
    return {
      type: 'session.presence',
      occurredAt: envelope.occurredAt,
      payload: { participantCount: envelope.payload.participantCount },
    }
  }
  return null
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
  if (envelope.type === 'caption.segment.final') {
    const payload = envelope.payload as ApiCaptionSegmentPayload
    return {
      type: 'caption.segment.final',
      occurredAt: envelope.occurredAt,
      payload: {
        sttSessionId: payload.sttSessionId,
        segmentIndex: payload.segmentIndex,
        lastSequence: payload.lastSequence,
        text: payload.text,
        startStreamElapsedMs: payload.startStreamElapsedMs,
        endStreamElapsedMs: payload.endStreamElapsedMs,
        boundaryReason: payload.boundaryReason,
        sessionMs: payload.sessionMs ?? null,
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
  if (item.type === 'caption.segment.final') {
    return [{
      type: 'caption.segment.final',
      occurredAt: item.occurredAt,
      payload: {
        sttSessionId: item.sttSessionId,
        segmentIndex: item.segmentIndex ?? 0,
        lastSequence: item.lastSequence ?? 0,
        text: item.text ?? '',
        startStreamElapsedMs: item.startStreamElapsedMs ?? item.streamElapsedMs,
        endStreamElapsedMs: item.endStreamElapsedMs ?? item.streamElapsedMs,
        boundaryReason: (item.boundaryReason ?? 'STREAM_END') as CaptionSegmentFinalPayload['boundaryReason'],
        sessionMs: item.sessionMs ?? null,
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

const AI_ANSWER_EVENT_TYPES = new Set(['answer.delta', 'answer.done', 'answer.insufficient', 'answer.error'])

/**
 * 근거 배열 정규화. 모르는 `type`은 **버린다** — 프록시가 ai-api 스키마를 그대로 흘리므로 AI가
 * 근거 종류를 늘리면 우리가 모르는 항목이 섞여 올 수 있는데(ADR-0047 §2), 그리는 법을 모르는 것을
 * 그리려다 화면이 깨지는 것보다 낫다. 답변 본문은 그대로 보인다.
 */
/**
 * 근거 발췌문. 계약상 <b>선택</b>이라 없을 수 있고(옛 답변), 빈 문자열은 없는 것과 같이 본다 —
 * 화면이 빈 칸을 그릴 이유가 없다.
 */
function readExcerpt(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text.length > 0 ? text : undefined
}

function normalizeAiAnswerSources(raw: unknown): AiAnswerSource[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): AiAnswerSource[] => {
    const source = item as Record<string, unknown>
    if (source?.type === 'PPTX') {
      return [{
        type: 'PPTX',
        materialId: String(source.materialId ?? ''),
        page: Number(source.page ?? 0),
        excerpt: readExcerpt(source.excerpt),
      }]
    }
    if (source?.type === 'CAPTION') {
      return [{
        type: 'CAPTION',
        sessionId: String(source.sessionId ?? ''),
        sttSessionId: String(source.sttSessionId ?? ''),
        startMs: Number(source.startMs ?? 0),
        endMs: Number(source.endMs ?? 0),
        excerpt: readExcerpt(source.excerpt),
      }]
    }
    return []
  })
}

/** SSE 프레임 하나를 계약 이벤트로 옮긴다. 모르는 event 이름·깨진 JSON은 무시한다(하트비트 주석 등). */
function toAiAnswerEvent(frame: SseFrame): AiAnswerStreamEvent | null {
  if (!AI_ANSWER_EVENT_TYPES.has(frame.event)) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(frame.data) as Record<string, unknown>
  } catch {
    return null
  }
  const requestId = String(payload.requestId ?? '')
  switch (frame.event) {
    case 'answer.delta':
      return { type: 'answer.delta', payload: { requestId, text: String(payload.text ?? '') } }
    case 'answer.done':
      return { type: 'answer.done', payload: { requestId, sources: normalizeAiAnswerSources(payload.sources) } }
    case 'answer.insufficient':
      return { type: 'answer.insufficient', payload: { requestId, message: String(payload.message ?? '') } }
    default:
      return {
        type: 'answer.error',
        payload: {
          requestId,
          code: String(payload.code ?? ''),
          message: String(payload.message ?? ''),
          retryable: payload.retryable === true,
        },
      }
  }
}

function isAbort(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

/**
 * 스트림 시작 전 실패를 화면이 분기할 수 있는 `ApiError`로 옮긴다(axios 응답 인터셉터와 같은 모양).
 * 401은 axios 쪽과 같은 규칙으로 CSRF 캐시를 버린다 — 재로그인 뒤 옛 토큰으로 403을 맞지 않게.
 */
async function toStreamStartError(response: Response) {
  if (response.status === 401) invalidateCsrfToken()
  let payload: ApiErrorEnvelope = {}
  try {
    payload = (await response.json()) as ApiErrorEnvelope
  } catch {
    // 봉투가 없는 실패(프록시·게이트웨이)도 있다. 상태코드만으로 안내한다.
  }
  return new ApiError(
    payload.message ?? '요청을 처리하지 못했습니다.',
    response.status,
    payload.code,
    payload.fieldErrors,
    payload.correlationId,
  )
}

/**
 * AI 답변 SSE 한 건을 읽는다. 라이브(ADR-0047)와 다시보기(ADR-0075)가 공유한다 — 경로와 body만
 * 다르고 이벤트·오류·취소 계약은 완전히 같다.
 *
 * `EventSource`는 GET만 지원하는데 이건 POST라 fetch + ReadableStream으로 SSE를 직접 읽는다.
 * 쿠키 세션이라 `credentials: 'include'`, 상태변경 요청이라 CSRF 헤더가 필요하다(ADR-0014) —
 * axios 인터셉터를 타지 않으므로 직접 붙인다.
 *
 * 경로가 `/stream`으로 끝나는 것은 계약이다. 운영 nginx는 `location ~ ^/api/.+/stream$`에만
 * proxy_buffering off를 적용해서, 다른 접미사면 토큰이 뭉쳐 스트리밍이 깨진다(운영에서만 드러난다).
 */
async function streamAiAnswer(
  url: string,
  body: Record<string, unknown>,
  { onEvent, signal }: AiAnswerStreamOptions,
) {
  if (isNetworkBlocked) {
    throw new ApiError(
      '테스트에서는 실제 네트워크 요청을 보낼 수 없습니다.',
      undefined,
      'MOCK_API_NETWORK_REQUEST_BLOCKED',
    )
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(await resolveCsrfHeader()),
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (isAbort(error, signal)) return
    throw new ApiError('AI 답변 요청을 보내지 못했습니다.', undefined, 'AI_ANSWER_NETWORK_FAILED')
  }

  if (!response.ok) throw await toStreamStartError(response)
  if (!response.body) {
    throw new ApiError('AI 답변 스트림을 읽을 수 없습니다.', response.status, 'AI_ANSWER_STREAM_UNREADABLE')
  }

  const decoder = createSseDecoder()
  const text = new TextDecoder()
  const reader = response.body.getReader()
  const emit = (frames: SseFrame[]) => {
    for (const frame of frames) {
      const event = toAiAnswerEvent(frame)
      if (event) onEvent(event)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      emit(decoder.push(text.decode(value, { stream: true })))
    }
    // 스트림이 개행 없이 끝나도 마지막 프레임을 흘리지 않는다.
    emit(decoder.flush())
  } catch (error) {
    // 취소는 사용자가 방금 한 행동이다 — 오류로 올리면 화면이 재시도 버튼을 띄운다.
    if (isAbort(error, signal)) return
    throw new ApiError('AI 답변 스트림이 끊겼습니다.', undefined, 'AI_ANSWER_STREAM_FAILED')
  } finally {
    // 중단됐다면 남은 바디를 버려 서버 쪽 릴레이(=ai-api 연결)까지 정리되게 한다.
    void reader.cancel().catch(() => undefined)
  }
}

export const httpLiveSessionService = {
  async getLiveSession(sessionId) {
    const { data } = await apiClient.get<ApiLiveSessionView>(`/live-sessions/${sessionId}`)
    return normalizeLiveSession(data, await fetchLessonCurriculumContext(data.lessonId))
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
    // 여기서 맥락을 빼면 폴링 응답이 캐시의 세션을 덮어써 사이드바가 도중에 기본 메뉴로 떨어진다.
    return {
      ...data,
      session: normalizeLiveSession(
        data.session,
        await fetchLessonCurriculumContext(data.session.lessonId),
      ),
    } satisfies LiveStartStatus
  },
  async endLiveSession(sessionId) {
    const { data } = await apiClient.post<ApiLiveSessionView>(`/live-sessions/${sessionId}/end`)
    return normalizeLiveSession(data, await fetchLessonCurriculumContext(data.lessonId))
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
  async sendChatMessage(sessionId, input) {
    const { data } = await apiClient.post<ApiChatMessage>(`/live-sessions/${sessionId}/messages`, {
      clientMessageId: input.clientMessageId,
      text: input.text,
      isQuestion: input.question,
      // 익명은 발신자 선택이다(ADR-0050). 체크하지 않으면 false로 보내 표시 이름이 노출된다.
      anonymous: input.anonymous,
      viewingSessionMs: null,
    })
    const message = normalizeMessage(data)
    return {
      ...message,
      // 서버가 mine을 주지만(전송 응답), 내가 보낸 것이라는 사실은 응답 필드 유무와 무관하게 확정이다.
      mine: true,
      clientMessageId: message.clientMessageId ?? input.clientMessageId,
      time: data.createdAt ? message.time : '현재',
    }
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
  subscribeSessionState(sessionId, onEvent, onConnectionChange) {
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
      client.subscribe(`/topic/live-sessions/${sessionId}/state`, (frame) => {
        try {
          const event = readSessionStateEnvelope(frame, sessionId)
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
  // 라이브 AI 질의응답(AI-QUESTION-01 / ADR-0047). `EventSource`는 GET만 지원하는데 이건 POST라
  // fetch + ReadableStream으로 SSE를 직접 읽는다. 쿠키 세션이라 credentials: 'include',
  // 상태변경 요청이라 CSRF 헤더가 필요하다(ADR-0014) — axios 인터셉터를 타지 않으므로 직접 붙인다.
  //
  // 경로가 `/stream`으로 끝나는 것은 계약이다. 운영 nginx는 `location ~ ^/api/.+/stream$`에만
  // proxy_buffering off를 적용해서, 다른 접미사면 토큰이 뭉쳐 스트리밍이 깨진다(운영에서만 드러난다).
  async askLiveAi(sessionId, question, options) {
    // body는 question 하나뿐이다. lessonId·contextTimeMs·requestId를 보내면 서버가 무시하는 게
    // 아니라, 클라 값을 신뢰하는 설계 자체를 막아 둔 것이다(ADR-0047 §1b·§5).
    await streamAiAnswer(`/api/live-sessions/${sessionId}/ai/answers/stream`, { question }, options)
  },
  /*
   * 다시보기 AI 질의응답(ADR-0075). 업로드 녹화강의와 **같은 endpoint**라 리더도 공유한다.
   *
   * playbackSessionMs는 플레이어 시각이 아니라 세션 상대 시간이다 — 호출자가
   * toSessionMs(mediaTime, source.availableFromMs)로 변환한 값을 넘긴다. 미디어 시각을 그대로
   * 보내면 근거 자막이 통째로 어긋난다.
   */
  async askReplayAi(lessonId, question, playbackSessionMs, options) {
    await streamLessonAiAnswer(lessonId, question, playbackSessionMs, options)
  },
  async saveBookmark(lessonId, sessionMs) {
    await apiClient.post(`/lessons/${lessonId}/bookmarks`, { sessionMs })
  },
  async getAiAnswerHistory(sessionId) {
    const { data } = await apiClient.get<AiAnswerHistoryItem[]>(
      `/live-sessions/${sessionId}/ai/answers`)
    return data
  },
  async getGlossary(lessonId) {
    const { data } = await apiClient.get<GlossaryTerm[]>(`/lessons/${lessonId}/glossary`)
    return data ?? []
  },
  async getMyWatchBuckets(lessonId) {
    const { data } = await apiClient.get<Record<number, number>>(
      `/lessons/${lessonId}/watch-buckets/me`)
    return data ?? {}
  },
  async reportWatchBuckets(lessonId, counts) {
    // 누적 절대값이라 재전송이 횟수를 부풀리지 않는다(ADR-0063).
    await apiClient.put(`/lessons/${lessonId}/watch-buckets`, { bucketSizeMs: 10000, counts })
  },
  async getWatchHeatmap(lessonId, durationMs) {
    const query = durationMs && durationMs > 0 ? `?durationMs=${Math.round(durationMs)}` : ''
    const { data } = await apiClient.get<WatchHeatmap>(`/lessons/${lessonId}/watch-heatmap${query}`)
    return data
  },
  async getLectureNotes(sessionId) {
    const { data } = await apiClient.get<ApiLectureNote>(`/live-sessions/${sessionId}/notes`)
    return parseLectureNote(data)
  },
  subscribeLectureNotes(sessionId, onNote, onConnectionChange) {
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
      client.subscribe(`/topic/live-sessions/${sessionId}/notes`, (frame) => {
        try {
          const envelope = JSON.parse(frame.body) as {
            type: string
            sessionId: string
            payload: ApiLectureNote
          }
          if (envelope.sessionId !== sessionId || envelope.type !== 'lecture.note.updated') return
          onNote(parseLectureNote(envelope.payload))
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
  async getProcessingStatus(sessionId) {
    const { data } = await apiClient.get<ProcessingStatus>(
      `/instructor/live-sessions/${sessionId}/processing`)
    return data
  },
  async getQuestionHighlights(sessionId) {
    return notImplemented(`GET /instructor/live-sessions/${sessionId}/question-highlights`)
  },
} satisfies LiveSessionService
