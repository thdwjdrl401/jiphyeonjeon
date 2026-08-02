import { emptyAiAnswerState, reduceAiAnswer, type AiAnswerAction, type AiAnswerState } from './aiAnswer'

/**
 * 개인 AI 질의응답의 **대화 이력**(AI-QUESTION-01, `docs/frontend/components/LIVE_LESSON.md` §4.3).
 *
 * 한 번에 한 질문만 붙잡던 화면을 챗 형태로 바꾸면서, 턴 하나의 상태는 기존 `reduceAiAnswer`를
 * 그대로 재사용하고 이 리듀서는 **어느 턴에 이벤트를 흘릴지**만 정한다 — 델타 누적·terminal 3분기·
 * 재시도 가능 판정은 이미 계약대로 고정돼 있으므로 두 번 쓰지 않는다.
 *
 * 새로고침·탭 재마운트에도 남는다 — 서버가 내 질문 기록을 돌려주고(`GET .../ai/answers`) 화면이
 * 그것으로 대화를 되살린다(`restore`). 이전에는 이 컴포넌트가 살아 있는 동안만 남아서, 새로고침 한 번에
 * 대화가 통째로 사라졌다.
 */
export interface AiConversationTurn extends AiAnswerState {
  /** 렌더 key와 이벤트 라우팅용 턴 식별자. 서버 requestId와는 무관하다(스트림 시작 전 실패도 턴이다). */
  id: string
}

export interface AiConversationState {
  turns: AiConversationTurn[]
}

export type AiConversationAction =
  /**
   * 서버에 남은 내 질문 기록으로 대화를 되살린다(새로고침·재접속).
   *
   * 진행 중인 턴이 있으면 무시한다 — 늦게 도착한 조회 응답이 지금 흐르는 답변을 지우면 안 된다.
   * 이미 되살린 뒤에도 무시한다(같은 대화를 두 번 쌓지 않는다).
   */
  | { kind: 'restore'; turns: AiConversationTurn[] }
  /** 새 질문을 목록 끝에 붙인다(낙관적 표시 — 전송 즉시 내 질문이 보인다). */
  | { kind: 'ask'; id: string; question: string }
  /** 실패한 턴을 그 자리에서 같은 질문으로 되돌린다. 질문 말풍선이 중복되지 않는다. */
  | { kind: 'retry'; id: string }
  /** 진행 중인 턴 하나를 취소로 닫는다. 어느 턴인지는 상태가 안다. */
  | { kind: 'cancel' }
  | { kind: 'turn'; id: string; action: AiAnswerAction }

export const emptyAiConversationState: AiConversationState = { turns: [] }

/** 지금 스트리밍 중인 턴. 없으면 null — 새 질문·재시도를 받아도 되는지의 기준이다. */
export function selectStreamingTurn(state: AiConversationState): AiConversationTurn | null {
  return state.turns.find((turn) => turn.status === 'streaming') ?? null
}

export function reduceAiConversation(state: AiConversationState, action: AiConversationAction): AiConversationState {
  switch (action.kind) {
    case 'ask': {
      // 스트림 하나가 끝나기 전에 또 보내면 앞 요청이 버려진다. 화면도 전송을 막지만 여기서도 막는다.
      if (selectStreamingTurn(state)) return state
      const turn = { ...reduceAiAnswer(emptyAiAnswerState, { kind: 'ask', question: action.question }), id: action.id }
      return { turns: [...state.turns, turn] }
    }
    case 'restore': {
      if (state.turns.length > 0 || selectStreamingTurn(state)) return state
      return { turns: action.turns }
    }
    case 'retry': {
      const target = state.turns.find((turn) => turn.id === action.id)
      if (!target || selectStreamingTurn(state)) return state
      return applyToTurn(state, action.id, { kind: 'ask', question: target.question })
    }
    case 'cancel': {
      const streaming = selectStreamingTurn(state)
      if (!streaming) return state
      return applyToTurn(state, streaming.id, { kind: 'cancelled' })
    }
    case 'turn':
      return applyToTurn(state, action.id, action.action)
    default:
      return state
  }
}

/**
 * 지목한 턴에만 답변 리듀서를 적용한다.
 *
 * 바뀐 턴만 새 객체로 갈고 나머지는 **같은 참조로 되돌린다** — 델타마다 이력 전체가 다시 그려지지 않게
 * 하는 근거다(턴 컴포넌트는 memo). 아무것도 안 바뀌면 상태 객체 자체를 그대로 돌려준다.
 */
function applyToTurn(state: AiConversationState, id: string, action: AiAnswerAction): AiConversationState {
  let changed = false
  const turns = state.turns.map((turn) => {
    if (turn.id !== id) return turn
    const next = reduceAiAnswer(turn, action)
    if (next === turn) return turn
    changed = true
    return { ...next, id }
  })
  return changed ? { turns } : state
}
