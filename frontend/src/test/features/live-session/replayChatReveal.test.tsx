import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import type { ChatMessageView } from '@/features/live-session/liveSessionService'

const messages: ChatMessageView[] = [
  { id: 'msg-1', alias: '학생 1', text: '초반 질문', time: '10:00', sessionMs: 60_000, question: true },
  { id: 'msg-2', alias: '학생 2', text: '중반 감상', time: '10:20', sessionMs: 1_200_000 },
  { id: 'msg-3', alias: '학생 3', text: '후반 질문', time: '10:50', sessionMs: 3_000_000, question: true },
]

function sidebar(revealThroughMs: number | null | undefined) {
  return (
    <LearningSidebar
      panel="discussion"
      onPanelChange={() => undefined}
      selectedTermId={null}
      onSelectedTermChange={() => undefined}
      lectureNote={null}
      glossaryTerms={[]}
      messages={messages}
      myDisplayName="나"
      revealThroughMs={revealThroughMs}
      aiContent={null}
      noteContext="REPLAY"
    />
  )
}

/**
 * 다시보기 채팅의 시간 동기화.
 *
 * <p>이 화면은 세션 전체를 한 번에 불러오므로, 자르지 않으면 0:00에서 강의 끝 무렵 질문이 이미 떠
 * 있다 — 무엇에 대한 이야기인지 알 수 없는 목록이 된다.
 */
describe('다시보기 채팅 — 재생 위치까지만 드러난다', () => {
  it('재생 위치를 지난 채팅만 보이고 미래의 채팅은 없다', () => {
    render(sidebar(1_200_000))

    expect(screen.getByText('초반 질문')).toBeInTheDocument()
    expect(screen.getByText('중반 감상')).toBeInTheDocument()
    expect(screen.queryByText('후반 질문')).not.toBeInTheDocument()
  })

  /** 목록에 셋뿐인데 "질문 12"가 뜨면 배지가 거짓말이 된다. */
  it('개수 배지도 드러난 것만 센다', () => {
    render(sidebar(1_200_000))

    expect(screen.getByRole('button', { name: '전체 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '질문 1' })).toBeInTheDocument()
  })

  it('되감으면 목록이 줄어든다', () => {
    const { rerender } = render(sidebar(3_000_000))
    expect(screen.getByText('후반 질문')).toBeInTheDocument()

    rerender(sidebar(60_000))
    expect(screen.queryByText('후반 질문')).not.toBeInTheDocument()
    expect(screen.getByText('초반 질문')).toBeInTheDocument()
  })

  /** 아직 아무것도 안 지난 것과, 애초에 채팅이 없던 것은 다른 상황이다. */
  it('시작 지점에서는 아직 올라온 채팅이 없다고 알린다', () => {
    render(sidebar(0))

    expect(screen.getByText(/이 지점까지 올라온 채팅이 없습니다/)).toBeInTheDocument()
  })

  /** 라이브는 지금이 곧 최신이라 자르지 않는다. 같은 컴포넌트가 두 화면을 겸한다. */
  it('위치를 주지 않는 화면(라이브)에서는 전부 보인다', () => {
    render(sidebar(undefined))

    expect(screen.getByText('후반 질문')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전체 3' })).toBeInTheDocument()
  })
})
