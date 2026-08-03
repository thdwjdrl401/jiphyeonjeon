import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import CaptionDock from '@/features/live-session/CaptionDock'
import type { CaptionView } from '@/features/live-session/liveSessionService'

/**
 * 자막을 위로 올려 지난 내용을 읽는 동안, 새 자막이 도착해도 끌려 내려가지 않아야 한다.
 *
 * 예전에는 조건 없이 매번 맨 아래로 보내서 사실상 되돌아볼 수 없었다. 지금 재생 위치는
 * `is-current` 하이라이트가 알려주므로 스크롤까지 붙잡아 둘 이유가 없다.
 */
function line(index: number): CaptionView {
  return {
    segmentId: `caption-${index}`,
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    at: `00:${String(index).padStart(2, '0')}`,
    text: `${index}번째 자막입니다.`,
    termReferences: [],
    synced: true,
  }
}

/** jsdom은 레이아웃을 계산하지 않는다. 스크롤 판정에 쓰는 세 값만 우리가 정해 준다. */
function fakeScrollBox(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
}

function renderDock(count: number) {
  const captions = Array.from({ length: count }, (_, i) => line(i))
  const result = render(
    <CaptionDock
      captions={captions}
      currentSessionMs={0}
      label="실시간 자막"
      onSeek={() => {}}
      onSelectTerm={() => {}}
    />,
  )
  const box = result.container.querySelector('.caption-dock__sentences') as HTMLElement
  return { ...result, box, captions }
}

describe('자막 스크롤 추종', () => {
  let box: HTMLElement
  let rerender: ReturnType<typeof renderDock>['rerender']

  beforeEach(() => {
    const rendered = renderDock(5)
    box = rendered.box
    rerender = rendered.rerender
    fakeScrollBox(box, { scrollHeight: 500, clientHeight: 150 })
  })

  function addCaption(count: number) {
    rerender(
      <CaptionDock
        captions={Array.from({ length: count }, (_, i) => line(i))}
        currentSessionMs={0}
        label="실시간 자막"
        onSeek={() => {}}
        onSelectTerm={() => {}}
      />,
    )
  }

  it('바닥에 붙어 있으면 새 자막을 따라 내려간다', () => {
    box.scrollTop = 350 // 500 - 150 = 바닥
    fireEvent.scroll(box)

    fakeScrollBox(box, { scrollHeight: 600, clientHeight: 150 })
    addCaption(6)

    expect(box.scrollTop).toBe(600)
  })

  it('위로 올려 두면 새 자막이 와도 그 자리에 머문다', () => {
    box.scrollTop = 100 // 바닥에서 250px 위 — 지난 자막을 읽는 중이다
    fireEvent.scroll(box)

    fakeScrollBox(box, { scrollHeight: 600, clientHeight: 150 })
    addCaption(6)

    expect(box.scrollTop).toBe(100)
  })

  it('올렸다가 다시 바닥으로 내리면 추종이 되살아난다', () => {
    box.scrollTop = 100
    fireEvent.scroll(box)
    box.scrollTop = 350
    fireEvent.scroll(box)

    fakeScrollBox(box, { scrollHeight: 600, clientHeight: 150 })
    addCaption(6)

    expect(box.scrollTop).toBe(600)
  })

  it('바닥에서 몇 px 떠 있는 것은 바닥으로 본다', () => {
    // 소수점 높이·확대 배율에서 scrollTop이 정확히 맞아떨어지지 않는다.
    box.scrollTop = 340
    fireEvent.scroll(box)

    fakeScrollBox(box, { scrollHeight: 600, clientHeight: 150 })
    addCaption(6)

    expect(box.scrollTop).toBe(600)
  })
})

describe('자막 높이', () => {
  it('자막이 없어도 자리를 지킨다', () => {
    // 첫 자막이 도착하며 독이 자라면 아래 요소가 통째로 밀려 화면이 움직인다.
    const { container } = render(
      <CaptionDock
        captions={[]}
        currentSessionMs={0}
        heightPx={200}
        label="실시간 자막"
        onSeek={() => {}}
        onSelectTerm={() => {}}
      />,
    )
    const box = container.querySelector('.caption-dock__sentences') as HTMLElement
    expect(box.style.height).toBe('200px')
    expect(container.querySelector('.caption-dock__empty')).not.toBeNull()
  })
})
