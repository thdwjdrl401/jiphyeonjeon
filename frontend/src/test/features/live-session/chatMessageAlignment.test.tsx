import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import type { ChatMessageView } from '@/features/live-session/liveSessionService'

/**
 * 채팅 좌우 정렬. 서버가 주는 `mine`(요청자 본인 여부)만으로 판정한다 — userId를 노출하지 않으므로
 * FE가 발신자를 직접 비교할 수 없고, alias는 동명이인이 가능해 신뢰할 수 없다.
 * 강사·수강생이 같은 컴포넌트를 쓰므로 이 규칙이 두 화면에 그대로 적용된다.
 */
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

function articleOf(container: HTMLElement, text: string) {
  const paragraph = screen.getByText(text)
  const article = paragraph.closest('article')
  expect(article, `"${text}" 메시지의 article을 찾지 못했다`).not.toBeNull()
  expect(container.contains(article!)).toBe(true)
  return article!
}

describe('채팅 메시지 좌우 정렬', () => {
  it('내 메시지에만 is-mine을 붙이고 남의 메시지에는 붙이지 않는다', () => {
    const { container } = render(sidebar([
      { id: 'm1', alias: '수강생-0473', text: '남이 보낸 것', time: '10:00' },
      { id: 'm2', alias: '', text: '내가 보낸 것', time: '10:01', mine: true },
    ]))

    expect(articleOf(container, '남이 보낸 것').className).not.toContain('is-mine')
    expect(articleOf(container, '내가 보낸 것').className).toContain('is-mine')
  })

  it('mine이 없으면(WS 에코·다시보기) 남의 메시지로 본다', () => {
    const { container } = render(sidebar([
      { id: 'm1', alias: '수강생-0473', text: 'mine 없음', time: '10:00' },
    ]))

    expect(articleOf(container, 'mine 없음').className).not.toContain('is-mine')
  })

  it('내 메시지에는 alias 대신 내 닉네임을 쓴다', () => {
    render(sidebar([
      { id: 'm1', alias: '익명1', text: '남의 것', time: '10:00' },
      { id: 'm2', alias: '익명9', text: '내 것', time: '10:01', mine: true },
    ]))

    expect(screen.getByText('익명1')).toBeInTheDocument()
    expect(screen.queryByText('익명9')).not.toBeInTheDocument()
    // 아바타 폴백 이니셜("나")과도 겹치므로 이름 자리(strong)로 좁혀 찾는다.
    expect(screen.getByText('나', { selector: 'strong' })).toBeInTheDocument()
  })

  it('낙관적 항목(시각 미확정)은 우측이면서 빈 시각을 그리지 않는다', () => {
    const { container } = render(sidebar([
      { id: 'local-1', clientMessageId: 'local-1', alias: '', text: '보내는 중', time: '', mine: true, pending: true },
    ]))

    const article = articleOf(container, '보내는 중')
    expect(article.className).toContain('is-mine')
    expect(article.querySelector('time')).toBeNull()
  })
})
