import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useResizablePane } from '@/features/live-session/useResizablePane'

/**
 * 경계를 끌어 크기를 바꾸고, 최소치 아래로 끌면 접힌다(그리고 다시 편다).
 *
 * 접기를 크기의 연장으로 둔 것이 이 훅의 핵심이다 — 별도 버튼을 두면 "끝까지 줄였는데 왜 안
 * 없어지지"가 된다.
 */
function Harness({ storageKey = 'test.pane' }: { storageKey?: string }) {
  const pane = useResizablePane({
    storageKey,
    defaultSize: 300,
    min: 200,
    max: 600,
    axis: 'inline',
    direction: -1,
    label: '패널 너비 조절',
  })
  return (
    <>
      <div {...pane.handleProps} />
      <output>{pane.collapsed ? 'collapsed' : pane.size}</output>
    </>
  )
}

function handle() {
  return screen.getByRole('separator', { name: '패널 너비 조절' })
}

/**
 * jsdom에는 포인터 캡처가 없고, jsdom의 PointerEvent는 clientX를 싣지 않는다.
 * 드래그 중 좌표는 네이티브 리스너가 읽으므로 MouseEvent로 만들어 보낸다(타입만 pointer*다).
 */
function drag(from: number, to: number) {
  const el = handle()
  el.setPointerCapture = () => {}
  // fireEvent에 이벤트를 직접 넘기면 act()로 감싸 준다 — 직접 dispatch하면 렌더가 안 밀린다.
  fireEvent(el, new MouseEvent('pointerdown', { clientX: from, bubbles: true }))
  fireEvent(el, new MouseEvent('pointermove', { clientX: to, bubbles: true }))
  fireEvent(el, new MouseEvent('pointerup', { bubbles: true }))
}

describe('useResizablePane', () => {
  beforeEach(() => window.localStorage.clear())

  it('끌면 크기가 그만큼 변한다', () => {
    render(<Harness />)
    drag(500, 420) // 왼쪽으로 80px → 300 + 80
    expect(screen.getByText('380')).toBeInTheDocument()
  })

  it('최대치를 넘지 않는다', () => {
    render(<Harness />)
    drag(500, 0)
    expect(screen.getByText('600')).toBeInTheDocument()
  })

  it('최소치의 절반 아래로 끌면 접힌다', () => {
    render(<Harness />)
    // 300 → 300-250 = 50. 최소 200의 절반(100)보다 작다.
    drag(500, 750)
    expect(screen.getByText('collapsed')).toBeInTheDocument()
  })

  it('최소치와 접힘 사이로 끌면 최소치에서 멈춘다', () => {
    render(<Harness />)
    // 300 → 300-150 = 150. 접힘 문턱(100)보다는 크므로 최소치로 붙는다.
    drag(500, 650)
    expect(screen.getByText('200')).toBeInTheDocument()
  })

  it('두 번 누르면 접히고, 다시 누르면 접기 전 크기로 돌아온다', () => {
    render(<Harness />)
    drag(500, 420)
    expect(screen.getByText('380')).toBeInTheDocument()

    fireEvent.doubleClick(handle())
    expect(screen.getByText('collapsed')).toBeInTheDocument()

    // 기본값(300)이 아니라 접기 직전 값으로 돌아와야 한다.
    fireEvent.doubleClick(handle())
    expect(screen.getByText('380')).toBeInTheDocument()
  })

  it('방향키로도 조절한다', () => {
    render(<Harness />)
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(screen.getByText('316')).toBeInTheDocument()

    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByText('252')).toBeInTheDocument()
  })

  it('Enter로 접었다 편다', () => {
    render(<Harness />)
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(screen.getByText('collapsed')).toBeInTheDocument()
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(screen.getByText('300')).toBeInTheDocument()
  })

  it('다음에 열 때 크기를 기억한다', () => {
    const { unmount } = render(<Harness />)
    drag(500, 420)
    unmount()

    render(<Harness />)
    // 매번 다시 맞추게 하면 조절 기능이 있으나 마나다.
    expect(screen.getByText('380')).toBeInTheDocument()
  })

  it('화면이 다르면 설정도 다르다', () => {
    const { unmount } = render(<Harness storageKey="live" />)
    drag(500, 420)
    unmount()

    render(<Harness storageKey="replay" />)
    expect(screen.getByText('300')).toBeInTheDocument()
  })

  it('접힘 상태를 손잡이가 알린다', () => {
    render(<Harness />)
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(handle().className).toContain('is-collapsed')
    expect(handle()).toHaveAttribute('aria-valuenow', '0')
  })
})
