import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AnnotationActionRing, { type AnnotationAction } from '@/features/live-session/AnnotationActionRing'

const ACTIONS: AnnotationAction[] = [
  { id: 'diagram', label: '다이어그램', hint: '다이어그램으로', icon: null },
  { id: 'math', label: '수식', hint: '수식으로', icon: null },
]

function ring(overrides: Partial<Parameters<typeof AnnotationActionRing>[0]> = {}) {
  return render(
    <AnnotationActionRing
      center={{ x: 100, y: 80 }}
      actions={ACTIONS}
      onPick={vi.fn()}
      onDismiss={vi.fn()}
      {...overrides}
    />,
  )
}

describe('판서 액션 링', () => {
  it('선택한 자리에 뜬다 — 화면 구석으로 시선을 옮기게 하지 않는다', () => {
    const { container } = ring()

    const element = container.querySelector<HTMLElement>('.annotation-action-ring')!
    expect(element.style.left).toBe('100px')
    expect(element.style.top).toBe('80px')
  })

  /**
   * 정리 대상이 보이지 않으면 무엇을 정리하는지 확인할 수 없다. 안쪽은 비워 둔다.
   *
   * <p>자리는 이제 `transform`이 아니라 <b>CSS 변수</b>로 나간다 — 중심에서 이 자리로 퍼지는
   * 애니메이션이 그 값을 읽어 움직이기 때문이다(`annotation-ring-out`). 기하는 그대로다.
   */
  it('항목을 중심에서 떨어진 원주에 놓는다', () => {
    const { container } = ring()

    const items = [...container.querySelectorAll<HTMLElement>('.annotation-action-ring__item')]
    expect(items).toHaveLength(2)
    // 12시에서 시작해 시계방향 — 첫 항목은 위쪽(y가 음수)
    expect(items[0].style.getPropertyValue('--ring-x')).toBe('0px')
    expect(items[0].style.getPropertyValue('--ring-y')).toBe('-84px')
    const radii = items.map((el) => Math.hypot(
      Number.parseFloat(el.style.getPropertyValue('--ring-x')),
      Number.parseFloat(el.style.getPropertyValue('--ring-y')),
    ))
    expect(radii.every((r) => Math.abs(r - 84) < 0.5)).toBe(true)
  })

  /** 항목마다 조금씩 늦게 출발해야 부채꼴로 펼쳐 보인다 — 동시에 나오면 그냥 나타나는 것이다. */
  it('항목이 순서대로 늦게 출발한다', () => {
    const { container } = ring()

    const delays = [...container.querySelectorAll<HTMLElement>('.annotation-action-ring__item')]
      .map((el) => el.style.getPropertyValue('--ring-step'))
    expect(delays[0]).toBe('0ms')
    expect(Number.parseFloat(delays[1])).toBeGreaterThan(0)
  })

  /**
   * 같은 선택에 두 번 요청하면 결과가 겹친다 — 먼저 온 응답을 적용한 뒤 나중 것이 다시 덮으면
   * 강사가 확인하지 않은 내용이 들어간다.
   */
  it('요청이 도는 동안 링 전체를 잠근다', () => {
    const { container } = ring({ busyActionId: 'math' })

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.every((b) => b.disabled)).toBe(true)
    expect(container.querySelector('.annotation-action-ring__item.is-running')).not.toBeNull()
  })

  it('고른 항목 id를 그대로 넘긴다', () => {
    const onPick = vi.fn()
    const { getByText } = ring({ onPick })

    getByText('수식').closest('button')!.click()

    expect(onPick).toHaveBeenCalledWith('math')
  })

  it('항목이 없으면 그리지 않는다', () => {
    const { container } = ring({ actions: [] })

    expect(container.querySelector('.annotation-action-ring')).toBeNull()
  })
})
