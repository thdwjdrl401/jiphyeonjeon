import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api/client'
import {
  emptyAiConversationState,
  reduceAiConversation,
  selectStreamingTurn,
  type AiConversationState,
} from '@/features/ai/aiConversation'

const ask = (state: AiConversationState, id: string, question: string) =>
  reduceAiConversation(state, { kind: 'ask', id, question })

const delta = (state: AiConversationState, id: string, text: string) =>
  reduceAiConversation(state, { kind: 'turn', id, action: { kind: 'event', event: { type: 'answer.delta', payload: { requestId: 'r', text } } } })

const done = (state: AiConversationState, id: string) =>
  reduceAiConversation(state, { kind: 'turn', id, action: { kind: 'event', event: { type: 'answer.done', payload: { requestId: 'r', sources: [] } } } })

/**
 * 대화 이력 리듀서(AI-QUESTION-01).
 *
 * 컴포넌트를 띄우지 않고 고정하는 건 두 가지다 — (1) 새 질문이 이전 턴을 지우지 않고 쌓인다,
 * (2) 델타는 지목한 턴만 갈고 나머지 턴 객체는 **같은 참조로 남는다**(memo 재렌더 억제 근거).
 */
describe('AI 대화 이력 리듀서', () => {
  it('질문을 목록 끝에 쌓고 이전 턴을 지우지 않는다', () => {
    let state = ask(emptyAiConversationState, 't1', '첫 질문')
    state = delta(state, 't1', '첫 답변')
    state = done(state, 't1')
    state = ask(state, 't2', '두 번째 질문')

    expect(state.turns.map((turn) => turn.question)).toEqual(['첫 질문', '두 번째 질문'])
    expect(state.turns[0]).toMatchObject({ status: 'done', text: '첫 답변' })
    expect(state.turns[1]).toMatchObject({ status: 'streaming', text: '' })
  })

  it('델타는 지목한 턴만 갈고 다른 턴은 같은 객체로 남는다', () => {
    let state = ask(emptyAiConversationState, 't1', '첫 질문')
    state = done(state, 't1')
    const firstTurn = state.turns[0]
    state = ask(state, 't2', '두 번째 질문')

    const afterDelta = delta(state, 't2', '조각')

    expect(afterDelta.turns[0]).toBe(firstTurn)
    expect(afterDelta.turns[1].text).toBe('조각')
  })

  it('스트리밍 중에는 새 질문도 재시도도 받지 않는다', () => {
    const streaming = ask(emptyAiConversationState, 't1', '진행 중 질문')

    expect(ask(streaming, 't2', '겹친 질문')).toBe(streaming)
    expect(reduceAiConversation(streaming, { kind: 'retry', id: 't1' })).toBe(streaming)
    expect(selectStreamingTurn(streaming)?.id).toBe('t1')
  })

  it('재시도는 같은 질문으로 그 자리의 턴을 되돌린다', () => {
    let state = ask(emptyAiConversationState, 't1', '실패할 질문')
    state = delta(state, 't1', '중간까지')
    state = reduceAiConversation(state, {
      kind: 'turn',
      id: 't1',
      action: { kind: 'failed', error: new ApiError('일시 장애', 503, 'AI_ANSWER_UNAVAILABLE') },
    })
    expect(state.turns[0]).toMatchObject({ status: 'error', retryable: true })

    const retried = reduceAiConversation(state, { kind: 'retry', id: 't1' })

    // 질문 말풍선이 하나 더 생기지 않는다 — 실패한 턴을 그 자리에서 다시 돌린다.
    expect(retried.turns).toHaveLength(1)
    expect(retried.turns[0]).toMatchObject({ id: 't1', question: '실패할 질문', status: 'streaming', text: '', notice: '' })
  })

  it('취소는 진행 중인 턴 하나만 닫고, 없으면 상태를 그대로 둔다', () => {
    let state = ask(emptyAiConversationState, 't1', '질문')
    state = done(state, 't1')
    expect(reduceAiConversation(state, { kind: 'cancel' })).toBe(state)

    state = ask(state, 't2', '취소할 질문')
    const cancelled = reduceAiConversation(state, { kind: 'cancel' })

    expect(cancelled.turns[0].status).toBe('done')
    expect(cancelled.turns[1]).toMatchObject({ status: 'cancelled', notice: '답변 생성을 취소했습니다.' })
  })

  it('모르는 턴 id로 온 이벤트는 이력을 바꾸지 않는다', () => {
    const state = ask(emptyAiConversationState, 't1', '질문')

    expect(delta(state, 'unknown', '유령 델타')).toBe(state)
  })
})
