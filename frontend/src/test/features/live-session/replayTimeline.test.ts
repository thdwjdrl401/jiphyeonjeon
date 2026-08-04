import { describe, expect, it } from 'vitest'
import { selectVisibleMessages } from '@/features/live-session/replayTimeline'
import type { ChatMessageView } from '@/features/live-session/liveSessionService.interface'

function message(overrides: Partial<ChatMessageView> & { id: string }): ChatMessageView {
  return { alias: '수강생-0001', text: '질문 있습니다', time: '10:14', ...overrides }
}

describe('재생 위치 기준 채팅 노출 (selectVisibleMessages)', () => {
  const messages: ChatMessageView[] = [
    message({ id: 'a', sessionMs: 1_000 }),
    message({ id: 'b', sessionMs: 5_000 }),
    message({ id: 'c', sessionMs: 20_000 }),
  ]

  it('재생 위치까지 올라온 채팅만 남긴다', () => {
    expect(selectVisibleMessages(messages, 5_000).map((item) => item.id)).toEqual(['a', 'b'])
  })

  /** 경계에서 사라지면 "방금 그 말"을 찾으려 되감았을 때 없다. 같은 값은 포함이다. */
  it('재생 위치와 정확히 같은 시각의 채팅은 포함한다', () => {
    expect(selectVisibleMessages(messages, 1_000).map((item) => item.id)).toEqual(['a'])
  })

  it('되감으면 목록이 줄어든다 — 미래의 대화가 남아 있지 않다', () => {
    expect(selectVisibleMessages(messages, 0)).toHaveLength(0)
  })

  /** 라이브는 지금이 곧 최신이라 자를 이유가 없다. */
  it('위치가 null이면 전부 노출한다', () => {
    expect(selectVisibleMessages(messages, null)).toHaveLength(3)
  })

  /**
   * 서버가 시각을 확정하기 전의 낙관적 항목은 좌표가 없다. 여기서 숨기면 <b>방금 내가 쓴 말이
   * 사라진 것처럼</b> 보인다.
   */
  it('세션-ms가 없는 항목은 위치와 무관하게 남긴다', () => {
    const withOptimistic = [...messages, message({ id: 'mine', pending: true })]
    expect(selectVisibleMessages(withOptimistic, 0).map((item) => item.id)).toEqual(['mine'])
  })

  it('원본 배열을 건드리지 않는다', () => {
    selectVisibleMessages(messages, 0)
    expect(messages).toHaveLength(3)
  })
})
