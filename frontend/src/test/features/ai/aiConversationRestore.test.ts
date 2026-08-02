import { describe, expect, it } from 'vitest'
import {
  emptyAiConversationState,
  reduceAiConversation,
  type AiConversationTurn,
} from '@/features/ai/aiConversation'

function turn(id: string, question: string): AiConversationTurn {
  return {
    id,
    status: 'done',
    question,
    text: '답변',
    sources: [],
    notice: '',
    code: null,
    retryable: false,
  }
}

describe('AI 대화 복구', () => {
  it('빈 대화를 서버 기록으로 되살린다', () => {
    const next = reduceAiConversation(emptyAiConversationState, {
      kind: 'restore',
      turns: [turn('h-1', '첫 질문'), turn('h-2', '두 번째 질문')],
    })

    expect(next.turns.map((t) => t.question)).toEqual(['첫 질문', '두 번째 질문'])
  })

  it('이미 대화가 있으면 덮지 않는다 — 같은 대화를 두 번 쌓지 않는다', () => {
    const existing = reduceAiConversation(emptyAiConversationState, {
      kind: 'ask', id: 'live-1', question: '지금 한 질문',
    })

    const next = reduceAiConversation(existing, { kind: 'restore', turns: [turn('h-1', '옛 질문')] })
    expect(next).toBe(existing)
  })

  it('스트리밍 중이면 무시한다 — 늦게 온 조회가 흐르는 답변을 지우면 안 된다', () => {
    const streaming = reduceAiConversation(emptyAiConversationState, {
      kind: 'ask', id: 'live-1', question: '지금 묻는 중',
    })
    expect(streaming.turns[0].status).toBe('streaming')

    const next = reduceAiConversation(streaming, { kind: 'restore', turns: [turn('h-1', '옛 질문')] })
    expect(next.turns).toHaveLength(1)
    expect(next.turns[0].question).toBe('지금 묻는 중')
  })
})
