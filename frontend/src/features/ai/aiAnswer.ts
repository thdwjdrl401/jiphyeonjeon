import { ApiError } from '@/shared/api/client'
import { API_NOT_IMPLEMENTED } from '@/shared/api/notImplemented'
import type { AiAnswerSource, AiAnswerStreamEvent } from '@/features/live-session/liveSessionService'

/**
 * 개인 AI 질의응답의 화면 상태(AI-QUESTION-01).
 *
 * SSE 이벤트를 그대로 렌더에 물리지 않고 순수 리듀서를 한 겹 둔다 — 계약이 요구하는 분기가
 * "델타 누적 / 근거 있는 종료 / 근거 없음 / 오류"로 네 갈래고, 이 중 `insufficient`는 **오류가 아니다**.
 * 리듀서로 빼 두면 컴포넌트를 띄우지 않고도 분기를 고정할 수 있다(captionAdapter와 같은 결).
 */
export type AiAnswerStatus = 'idle' | 'streaming' | 'done' | 'insufficient' | 'error' | 'cancelled'

export interface AiAnswerState {
  status: AiAnswerStatus
  /** 이 답변을 만든 질문. 재시도가 같은 질문을 다시 보낸다. */
  question: string
  /** 지금까지 누적된 답변 본문. 델타가 도착하는 대로 자란다. */
  text: string
  sources: AiAnswerSource[]
  /** `insufficient`의 안내나 오류 메시지. 정상 흐름에서는 빈 문자열이다. */
  notice: string
  code: string | null
  retryable: boolean
}

export type AiAnswerAction =
  | { kind: 'ask'; question: string }
  | { kind: 'event'; event: AiAnswerStreamEvent }
  /** 스트림이 terminal 없이 끝났다(연결이 조용히 죽은 경우). */
  | { kind: 'ended' }
  /** 스트림이 시작되기 전 실패했다(HTTP 오류 봉투). */
  | { kind: 'failed'; error: unknown }
  | { kind: 'cancelled' }

export const emptyAiAnswerState: AiAnswerState = {
  status: 'idle',
  question: '',
  text: '',
  sources: [],
  notice: '',
  code: null,
  retryable: false,
}

const INSUFFICIENT_FALLBACK = '질문에 답할 근거를 강의 자료와 발화에서 찾지 못했습니다.'
const STREAM_FAILURE_NOTICE = '답변이 끝까지 전달되지 않았습니다. 다시 시도해 주세요.'

/**
 * 스트림 시작 전 실패의 안내 문구. 상태코드가 아니라 `code`로 고른다 — 같은 502라도
 * 사용자가 할 수 있는 일이 다르기 때문이다(ADR-0047 §7 / LIVE.md §10.1 오류 표).
 */
const ASK_FAILURE_NOTICES: Record<string, string> = {
  VALIDATION_FAILED: '질문은 1자 이상 4,000자 이하로 입력해 주세요.',
  LIVE_SESSION_FORBIDDEN: '이 강의의 수강생만 AI에게 질문할 수 있습니다.',
  LIVE_SESSION_NOT_FOUND: '라이브 세션을 찾을 수 없습니다.',
  AI_ANSWER_REQUEST_CONFLICT: '요청이 겹쳤습니다. 다시 시도해 주세요.',
  AI_ANSWER_UPSTREAM_REJECTED: 'AI 서비스가 요청을 거부했습니다. 계속되면 운영자 확인이 필요합니다.',
  AI_ANSWER_UNAVAILABLE: 'AI 답변을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  AI_ANSWER_NETWORK_FAILED: '네트워크가 불안정해 질문을 보내지 못했습니다.',
  AI_ANSWER_STREAM_FAILED: STREAM_FAILURE_NOTICE,
  [API_NOT_IMPLEMENTED]: '아직 준비 중인 기능입니다.',
}

/** 다시 눌러 볼 만한 실패인가. 정원 초과·일시 장애·네트워크는 그대로 재시도가 답이다. */
const RETRYABLE_FAILURE_CODES = new Set([
  'AI_ANSWER_REQUEST_CONFLICT',
  'AI_ANSWER_UNAVAILABLE',
  'AI_ANSWER_NETWORK_FAILED',
  'AI_ANSWER_STREAM_FAILED',
])

export function describeAskFailure(error: unknown): { notice: string; code: string | null; retryable: boolean } {
  if (!(error instanceof ApiError)) {
    return { notice: '질문을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.', code: null, retryable: true }
  }
  if (error.status === 401) {
    return { notice: '로그인이 필요합니다. 다시 로그인한 뒤 질문해 주세요.', code: null, retryable: false }
  }
  const code = error.code ?? null
  const notice = (code && ASK_FAILURE_NOTICES[code])
    ?? error.message
    ?? '질문을 보내지 못했습니다.'
  return { notice, code, retryable: code ? RETRYABLE_FAILURE_CODES.has(code) : true }
}

export function reduceAiAnswer(state: AiAnswerState, action: AiAnswerAction): AiAnswerState {
  switch (action.kind) {
    case 'ask':
      return { ...emptyAiAnswerState, status: 'streaming', question: action.question }
    case 'event':
      return reduceAiAnswerEvent(state, action.event)
    case 'ended':
      // terminal이 이미 왔으면 아무 일도 없다. 안 왔으면 스트림이 조용히 죽은 것이라 재시도를 연다 —
      // 서버는 보통 answer.error(PROXY_STREAM_INCOMPLETE)를 보내지만, 연결 자체가 끊기면 그것도 못 온다.
      if (state.status !== 'streaming') return state
      return { ...state, status: 'error', notice: STREAM_FAILURE_NOTICE, code: 'STREAM_INCOMPLETE', retryable: true }
    case 'failed': {
      const failure = describeAskFailure(action.error)
      return { ...state, status: 'error', text: '', sources: [], ...failure }
    }
    case 'cancelled':
      if (state.status !== 'streaming') return state
      return { ...state, status: 'cancelled', notice: '답변 생성을 취소했습니다.' }
    default:
      return state
  }
}

function reduceAiAnswerEvent(state: AiAnswerState, event: AiAnswerStreamEvent): AiAnswerState {
  // 취소한 뒤 늦게 도착한 이벤트가 화면을 되살리지 않게, 스트리밍 중일 때만 반응한다.
  if (state.status !== 'streaming') return state
  switch (event.type) {
    case 'answer.delta':
      return { ...state, text: state.text + event.payload.text }
    case 'answer.done':
      return { ...state, status: 'done', sources: event.payload.sources }
    case 'answer.insufficient':
      // 오류가 아니다 — 모델을 부르지 않았을 뿐이라 재시도 버튼도 띄우지 않는다.
      return { ...state, status: 'insufficient', notice: event.payload.message || INSUFFICIENT_FALLBACK }
    case 'answer.error':
      return {
        ...state,
        status: 'error',
        notice: event.payload.message || STREAM_FAILURE_NOTICE,
        code: event.payload.code,
        retryable: event.payload.retryable,
      }
    default:
      return state
  }
}

/**
 * 근거 자막 구간 라벨(`mm:ss` 또는 `h:mm:ss`).
 *
 * 입력은 **STT attempt-local `streamElapsedMs`** 이지 세션-ms가 아니다(ADR-0047 §9). 영상 위치와
 * 같은 축이 아니므로 이 값으로 seek을 걸지 않는다 — 라벨 전용이라 자막 독의 시각 포맷과 별도로 둔다.
 */
export function formatStreamElapsed(streamElapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(streamElapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const tail = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${tail}` : tail
}

/** 축약 없이 그대로 보여도 한 줄에 들어가는 길이. 이보다 길면 UUID로 보고 앞부분만 남긴다. */
