import { describe, expect, it } from 'vitest'
import { emptyAiAnswerState, formatStreamElapsed, reduceAiAnswer, type AiAnswerState } from '@/features/ai/aiAnswer'
import { ApiError } from '@/shared/api/client'

const asking = (question = '질문') => reduceAiAnswer(emptyAiAnswerState, { kind: 'ask', question })

const withEvents = (state: AiAnswerState, ...events: Parameters<typeof reduceAiAnswer>[1][]) =>
  events.reduce(reduceAiAnswer, state)

/**
 * AI 답변 상태 전이.
 *
 * 계약이 요구하는 갈래는 넷이고 그중 `insufficient`는 **오류가 아니다** — 근거를 못 찾아 모델을
 * 부르지 않은 정상 종료라, 오류로 접으면 화면이 쓸모없는 재시도를 권한다.
 */
describe('AI 답변 상태 전이', () => {
  it('델타를 순서대로 이어 붙이고 answer.done에서 근거와 함께 끝난다', () => {
    const state = withEvents(
      asking(),
      { kind: 'event', event: { type: 'answer.delta', payload: { requestId: 'r1', text: '앞' } } },
      { kind: 'event', event: { type: 'answer.delta', payload: { requestId: 'r1', text: '뒤' } } },
      { kind: 'event', event: { type: 'answer.done', payload: { requestId: 'r1', sources: [{ type: 'PPTX', materialId: 'mat-1', page: 3 }] } } },
    )

    expect(state).toMatchObject({
      status: 'done',
      text: '앞뒤',
      sources: [{ type: 'PPTX', materialId: 'mat-1', page: 3 }],
      notice: '',
    })
  })

  it('answer.insufficient는 오류가 아니라 별도 상태이고 재시도를 권하지 않는다', () => {
    const state = withEvents(asking(), {
      kind: 'event',
      event: { type: 'answer.insufficient', payload: { requestId: 'r1', message: '근거를 찾지 못했습니다' } },
    })

    expect(state.status).toBe('insufficient')
    expect(state.notice).toBe('근거를 찾지 못했습니다')
    expect(state.retryable).toBe(false)
  })

  it('answer.error는 code·retryable을 그대로 들고 오류로 끝난다', () => {
    const state = withEvents(
      asking(),
      { kind: 'event', event: { type: 'answer.delta', payload: { requestId: 'r1', text: '앞부분' } } },
      { kind: 'event', event: { type: 'answer.error', payload: { requestId: 'r1', code: 'PROXY_UPSTREAM_FAILED', message: '중계 실패', retryable: true } } },
    )

    // 이미 받은 본문은 지우지 않는다 — 도중까지 읽은 답이 사라지면 사용자가 무엇을 잃었는지 모른다.
    expect(state).toMatchObject({ status: 'error', text: '앞부분', code: 'PROXY_UPSTREAM_FAILED', retryable: true })
  })

  it('terminal 없이 스트림이 끝나면 재시도 가능한 오류가 된다', () => {
    const dropped = withEvents(
      asking(),
      { kind: 'event', event: { type: 'answer.delta', payload: { requestId: 'r1', text: '앞부분' } } },
      { kind: 'ended' },
    )
    expect(dropped).toMatchObject({ status: 'error', code: 'STREAM_INCOMPLETE', retryable: true })

    // terminal이 이미 왔으면 ended는 아무 일도 하지 않는다.
    const finished = withEvents(
      asking(),
      { kind: 'event', event: { type: 'answer.done', payload: { requestId: 'r1', sources: [] } } },
      { kind: 'ended' },
    )
    expect(finished.status).toBe('done')
  })

  it('취소한 뒤 늦게 도착한 이벤트는 화면을 되살리지 않는다', () => {
    const cancelled = withEvents(
      asking(),
      { kind: 'event', event: { type: 'answer.delta', payload: { requestId: 'r1', text: '앞부분' } } },
      { kind: 'cancelled' },
      { kind: 'event', event: { type: 'answer.done', payload: { requestId: 'r1', sources: [] } } },
    )

    expect(cancelled).toMatchObject({ status: 'cancelled', text: '앞부분' })
  })

  it('새 질문은 이전 답변·근거·오류를 지우고 시작한다', () => {
    const previous = withEvents(
      asking('첫 질문'),
      { kind: 'event', event: { type: 'answer.done', payload: { requestId: 'r1', sources: [{ type: 'PPTX', materialId: 'mat-1', page: 1 }] } } },
    )

    expect(reduceAiAnswer(previous, { kind: 'ask', question: '두 번째 질문' })).toEqual({
      ...emptyAiAnswerState,
      status: 'streaming',
      question: '두 번째 질문',
    })
  })

  it.each([
    ['AI_ANSWER_REQUEST_CONFLICT', 409, true],
    ['AI_ANSWER_UNAVAILABLE', 503, true],
    ['AI_ANSWER_UPSTREAM_REJECTED', 502, false],
    ['LIVE_SESSION_FORBIDDEN', 403, false],
    ['VALIDATION_FAILED', 400, false],
  ])('스트림 시작 전 %s 실패는 안내와 재시도 여부를 code로 고른다', (code, status, retryable) => {
    const state = reduceAiAnswer(asking(), { kind: 'failed', error: new ApiError('서버 문구', status, code) })

    expect(state.status).toBe('error')
    expect(state.code).toBe(code)
    expect(state.retryable).toBe(retryable)
    expect(state.notice).not.toBe('')
  })

  it('401은 재시도가 아니라 로그인을 안내한다', () => {
    const state = reduceAiAnswer(asking(), { kind: 'failed', error: new ApiError('인증 필요', 401) })

    expect(state).toMatchObject({ status: 'error', retryable: false })
    expect(state.notice).toContain('로그인')
  })

  it('재시도할 질문을 들고 있어 같은 질문을 다시 보낼 수 있다', () => {
    const state = reduceAiAnswer(asking('SecurityContext가 무엇인가요?'), { kind: 'failed', error: new ApiError('...', 503, 'AI_ANSWER_UNAVAILABLE') })

    expect(state.question).toBe('SecurityContext가 무엇인가요?')
  })
})

describe('근거 자막 시각 라벨', () => {
  it('STT 스트림 경과 ms를 mm:ss(한 시간 넘으면 h:mm:ss)로 적는다', () => {
    expect(formatStreamElapsed(0)).toBe('00:00')
    expect(formatStreamElapsed(55_000)).toBe('00:55')
    expect(formatStreamElapsed(728_000)).toBe('12:08')
    expect(formatStreamElapsed(3_700_000)).toBe('1:01:40')
    // 음수는 오지 않지만 라벨이 깨지느니 0으로 접는다.
    expect(formatStreamElapsed(-1)).toBe('00:00')
  })
})

