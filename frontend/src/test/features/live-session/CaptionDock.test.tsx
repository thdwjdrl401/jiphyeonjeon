import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CaptionDock from '@/features/live-session/CaptionDock'
import type { CaptionView } from '@/features/live-session/liveSessionService'

// 라벨은 이동 목표에서 파생된다 — 근사 축이면 728_000 − 지연(1_500) = 726_500 → '12:06'.
// 이 테스트가 보는 것은 시각이 버튼인지 time인지(이동 게이트)이지 숫자 자체가 아니다.
const caption: CaptionView = {
  segmentId: 'caption-1',
  startMs: 728_000,
  endMs: 732_000,
  at: '12:08',
  text: '종료 직전 자막입니다.',
  termReferences: [],
  synced: true,
}

describe('실시간 자막 시각 이동 게이트', () => {
  it('ENDING까지는 시각 버튼으로 이동할 수 있다', () => {
    const onSeek = vi.fn()
    render(
      <CaptionDock
        captions={[caption]}
        currentSessionMs={728_000}
        label="실시간 자막"
        onSeek={onSeek}
        onSelectTerm={() => {}}
        canSeek
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '12:06' }))
    expect(onSeek).toHaveBeenCalledOnce()
  })

  it('ENDED에서는 시각을 time으로 표시하고 이동을 만들지 않는다', () => {
    const onSeek = vi.fn()
    render(
      <CaptionDock
        captions={[caption]}
        currentSessionMs={728_000}
        label="실시간 자막"
        onSeek={onSeek}
        onSelectTerm={() => {}}
        canSeek={false}
      />,
    )

    expect(screen.queryByRole('button', { name: '12:06' })).not.toBeInTheDocument()
    expect(screen.getByText('12:06').tagName).toBe('TIME')
    expect(onSeek).not.toHaveBeenCalled()
  })
})

/**
 * 강사 화면은 <b>같은 독을 접어 둔 것</b>이다. 다른 화면을 따로 만들면 수강생이 보는 것과 강사가
 * 확인하는 것이 갈라져, 정작 확인의 뜻이 없어진다.
 *
 * <p>접힘은 <b>보여 주지 않는 것 이상</b>이다 — 접힌 동안에는 자막 WS도 붙지 않으므로(페이지 쪽
 * `captionsLive`), 접힌 채로 문장이 렌더되면 그 자체가 배선이 어긋났다는 신호다.
 */
describe('접었다 펴는 자막 독', () => {
  it('접히면 헤더만 남고 문장은 그리지 않는다', () => {
    render(
      <CaptionDock
        captions={[caption]}
        collapsed
        currentSessionMs={0}
        label="실시간 자막"
        onSeek={() => {}}
        onSelectTerm={() => {}}
        onToggleCollapse={() => {}}
        canSeek={false}
      />,
    )

    expect(screen.queryByText('종료 직전 자막입니다.')).toBeNull()
    // 다시 펼 자리는 이 줄뿐이다. 여기까지 사라지면 접은 사람이 그것이 자막이었다는 것을 잊는다.
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
  })

  it('헤더를 누르면 접힘을 뒤집는다', () => {
    const onToggleCollapse = vi.fn()
    render(
      <CaptionDock
        captions={[caption]}
        collapsed
        currentSessionMs={0}
        label="실시간 자막"
        onSeek={() => {}}
        onSelectTerm={() => {}}
        onToggleCollapse={onToggleCollapse}
        canSeek={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  /** 수강생 화면은 자막을 보러 온 화면이다 — 접을 이유가 없고, 접는 손잡이도 두지 않는다. */
  it('접기를 넘기지 않으면 헤더는 버튼이 아니다', () => {
    render(
      <CaptionDock
        captions={[caption]}
        currentSessionMs={728_000}
        label="실시간 자막"
        onSeek={() => {}}
        onSelectTerm={() => {}}
        canSeek
      />,
    )

    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
    expect(screen.queryByRole('button', { expanded: true })).toBeNull()
    expect(screen.getByText('종료 직전 자막입니다.')).toBeTruthy()
  })
})
