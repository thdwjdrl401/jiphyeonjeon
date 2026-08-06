import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import type { ChatMessageView } from '@/features/live-session/liveSessionService'

const initialMessages: ChatMessageView[] = [
  { id: 'msg-1', alias: '학생 1', text: '첫 번째 메시지', time: '10:00' },
  { id: 'msg-2', alias: '학생 2', text: '두 번째 메시지', time: '10:01' },
]

function sidebar(messages: ChatMessageView[]) {
  return (
    <LearningSidebar
      panel="discussion"
      onPanelChange={() => undefined}
      selectedTermId={null}
      onSelectedTermChange={() => undefined}
      glossaryFocusRequest={null}
      lectureNote={null}
      glossaryTerms={[]}
      messages={messages}
      myDisplayName="나"
      aiContent={null}
      noteContext="LIVE"
    />
  )
}

describe('라이브 채팅 스크롤 추적', () => {
  it('과거 채팅을 읽는 중에는 위치를 유지하고 버튼으로 최신 채팅 추적을 재개한다', () => {
    const { container, rerender } = render(sidebar(initialMessages))
    const chatList = container.querySelector('.chat-list') as HTMLDivElement
    Object.defineProperties(chatList, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500, writable: true },
      scrollTop: { configurable: true, value: 120, writable: true },
    })

    fireEvent.scroll(chatList)
    expect(screen.getByRole('button', { name: '↓ 최근 채팅으로 이동' })).toBeInTheDocument()

    rerender(sidebar([
      ...initialMessages,
      { id: 'msg-3', alias: '학생 3', text: '새 메시지', time: '10:02' },
    ]))
    expect(chatList.scrollTop).toBe(120)

    fireEvent.click(screen.getByRole('button', { name: '↓ 최근 채팅으로 이동' }))
    expect(chatList.scrollTop).toBe(500)
    expect(screen.queryByRole('button', { name: '↓ 최근 채팅으로 이동' })).not.toBeInTheDocument()

    Object.defineProperty(chatList, 'scrollHeight', { configurable: true, value: 650, writable: true })
    rerender(sidebar([
      ...initialMessages,
      { id: 'msg-3', alias: '학생 3', text: '새 메시지', time: '10:02' },
      { id: 'msg-4', alias: '학생 4', text: '가장 최근 메시지', time: '10:03' },
    ]))
    expect(chatList.scrollTop).toBe(650)
  })

  it('과거 채팅을 읽는 중에도 내가 막 보낸 메시지는 바닥으로 붙는다', () => {
    const { container, rerender } = render(sidebar(initialMessages))
    const chatList = container.querySelector('.chat-list') as HTMLDivElement
    Object.defineProperties(chatList, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500, writable: true },
      scrollTop: { configurable: true, value: 120, writable: true },
    })
    fireEvent.scroll(chatList)
    expect(screen.getByRole('button', { name: '↓ 최근 채팅으로 이동' })).toBeInTheDocument()

    // 남이 보낸 메시지는(위 테스트처럼) 자리를 지킨다. 내가 보낸 메시지는 다르다 — 전송은
    // "지금 여기를 보여 달라"는 명시적 요청이라, 읽던 자리와 무관하게 바닥으로 붙는다.
    Object.defineProperty(chatList, 'scrollHeight', { configurable: true, value: 560, writable: true })
    rerender(sidebar([
      ...initialMessages,
      { id: 'msg-mine', alias: '', text: '제가 방금 보낸 메시지', time: '10:04', mine: true },
    ]))
    expect(chatList.scrollTop).toBe(560)
    expect(screen.queryByRole('button', { name: '↓ 최근 채팅으로 이동' })).not.toBeInTheDocument()
  })
})
