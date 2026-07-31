import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AnnotationActionRing, { type AnnotationAction } from '@/features/live-session/AnnotationActionRing'
import AnnotationInterpretPreview from '@/features/live-session/AnnotationInterpretPreview'
import type { AnnotationInterpretation } from '@/features/live-session/annotationInterpret'

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

  /** 정리 대상이 보이지 않으면 무엇을 정리하는지 확인할 수 없다. 안쪽은 비워 둔다. */
  it('항목을 중심에서 떨어진 원주에 놓는다', () => {
    const { container } = ring()

    const offsets = [...container.querySelectorAll<HTMLElement>('.annotation-action-ring__item')]
      .map((el) => el.style.transform)
    expect(offsets).toHaveLength(2)
    // 12시에서 시작해 시계방향 — 첫 항목은 위쪽(y가 음수)
    expect(offsets[0]).toMatch(/-50% \+ 0px.*-50% \+ -84px/)
    expect(offsets.every((t) => t.includes('84') || t.includes('-84'))).toBe(true)
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

function preview(result: Partial<AnnotationInterpretation>, overrides: Record<string, unknown> = {}) {
  return render(
    <AnnotationInterpretPreview
      result={{
        kind: 'mermaid', body: 'flowchart LR\n  A[요청] --> B[인증]',
        replace: ['e1', 'e2'], confidence: 1, unreadable: false, ...result,
      }}
      applying={false}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  )
}

/**
 * 모델이 낸 `confidence`를 자동 적용의 근거로 쓸 수 없다 — 실측에서 한글 라벨을 `요청` → `유정`으로
 * 잘못 읽고도 <b>1.0</b>을 줬다. 그래서 확신도와 무관하게 항상 확인을 거친다.
 */
describe('해석 결과 확인', () => {
  it('확신도가 1.0이어도 원문을 보여 주고 확인을 받는다', () => {
    const { getByText, container } = preview({ confidence: 1 })

    expect(container.querySelector('.annotation-interpret-preview__body')!.textContent)
      .toContain('A[요청] --> B[인증]')
    expect(getByText('적용')).toBeTruthy()
    expect(getByText('취소')).toBeTruthy()
  })

  it('무엇이 지워지는지 개수로 알린다', () => {
    const { container } = preview({ replace: ['a', 'b', 'c'] })

    expect(container.querySelector('.annotation-interpret-preview__note')!.textContent)
      .toContain('3개')
  })

  /** 읽지 못한 것을 "적용"할 수는 없다. 지어낸 것을 넣는 것보다 못 읽었다고 말하는 편이 낫다. */
  it('읽지 못했으면 적용 버튼을 두지 않는다', () => {
    const { queryByText, getByText } = preview({ unreadable: true, body: '' })

    expect(queryByText('적용')).toBeNull()
    expect(getByText('닫기')).toBeTruthy()
  })

  it('적용하는 동안 두 버튼을 모두 잠근다', () => {
    const { getByText } = preview({}, { applying: true })

    expect(getByText('취소').closest('button')!.disabled).toBe(true)
    expect(getByText('적용하는 중…').closest('button')!.disabled).toBe(true)
  })
})
