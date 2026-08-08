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

  /**
   * 이름은 <b>남들에게 보이는 그대로</b> 쓴다.
   *
   * <p>예전에는 내 메시지만 내 닉네임으로 갈아 끼웠다. 그래서 익명으로 보내도 내 말풍선에는 내
   * 이름이 떴고, 강사와 다른 수강생에게는 `익명9`가 보였다 — <b>보내는 사람만 그 사실을 모른다.</b>
   * 익명이 되고 있는지 확인할 방법이 화면에 없었다.
   *
   * <p>내 것이라는 표시는 우측 정렬이 이미 한다. 이름까지 그 일을 겹쳐 할 이유가 없다.
   */
  it('익명으로 보낸 내 메시지도 남들이 보는 가명으로 보인다', () => {
    render(sidebar([
      { id: 'm1', alias: '익명1', text: '남의 것', time: '10:00' },
      { id: 'm2', alias: '익명9', text: '내 것', time: '10:01', mine: true },
    ]))

    expect(screen.getByText('익명1')).toBeInTheDocument()
    expect(screen.getByText('익명9', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByText('나', { selector: 'strong' })).not.toBeInTheDocument()
  })

  /** 익명이 아니면 서버가 내려 준 표시 이름이 그대로 뜬다 — 남들이 보는 것과 같다. */
  it('실명으로 보낸 내 메시지는 그 표시 이름으로 보인다', () => {
    render(sidebar([
      { id: 'm2', alias: '송정기', text: '내 것', time: '10:01', mine: true },
    ]))

    expect(screen.getByText('송정기', { selector: 'strong' })).toBeInTheDocument()
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

/**
 * 채팅에 프로필 사진을 그린다 — 다만 <b>익명 메시지에는 실릴 수 없다.</b>
 *
 * <p>이름을 가려도 사진이 실리면 사람이 특정된다. 같은 강의를 듣는 사람들끼리는 얼굴을 알고,
 * 프로필 사진은 대개 얼굴이다(ADR-0050). 그래서 서버가 익명 메시지에는 `avatarUrl`을 아예 내려보내지
 * 않는다 — 화면은 없는 것을 그릴 수 없다.
 */
describe('채팅 프로필 사진', () => {
  it('사진이 있으면 이니셜 대신 사진을 그린다', () => {
    const { container } = render(sidebar([
      { id: 'm1', alias: '김학생', text: '안녕하세요', time: '10:00', avatarUrl: 'https://cdn.test/a.png' },
    ]))

    expect(container.querySelector('.user-avatar--chat img')).toHaveAttribute('src', 'https://cdn.test/a.png')
  })

  it('사진이 없으면 이니셜로 채운다', () => {
    const { container } = render(sidebar([
      { id: 'm1', alias: '김학생', text: '안녕하세요', time: '10:00' },
    ]))

    expect(container.querySelector('.user-avatar--chat img')).toBeNull()
    expect(container.querySelector('.user-avatar--chat')?.textContent).toBe('김')
  })

  /** 서버가 안 내려보내는 것이 정본이지만, 화면도 그 전제를 잡아 둔다. */
  it('익명 메시지에는 사진이 오지 않는다', () => {
    const { container } = render(sidebar([
      { id: 'm1', alias: '익명1', text: '질문 있어요', time: '10:00' },
    ]))

    expect(container.querySelector('.user-avatar--chat img')).toBeNull()
    // 가명은 진짜 이름이 아니므로 이니셜도 쓰지 않는다.
    expect(container.querySelector('.user-avatar--chat')?.textContent).toBe('?')
  })
})
