import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'

const ITEMS: ReadonlyArray<TabItem<'one' | 'two' | 'three'>> = [
  { id: 'one', label: '첫째' },
  { id: 'two', label: '둘째' },
  { id: 'three', label: '셋째' },
]

function Harness() {
  const [value, setValue] = useState<'one' | 'two' | 'three'>('one')
  return (
    <>
      <Tabs idPrefix="t" label="테스트 탭" items={ITEMS} value={value} onChange={setValue} />
      <div {...tabPanelProps('t', value)}>{value} 패널</div>
    </>
  )
}

describe('Tabs', () => {
  it('tablist와 tab 역할을 붙이고 선택 상태를 aria-selected로 알린다', () => {
    render(<Tabs idPrefix="t" label="테스트 탭" items={ITEMS} value="two" onChange={vi.fn()} />)

    expect(screen.getByRole('tablist', { name: '테스트 탭' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '둘째' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '첫째' })).toHaveAttribute('aria-selected', 'false')
  })

  // 탭과 패널이 서로를 가리켜야 스크린리더가 "이 패널은 저 탭의 내용"임을 읽는다.
  it('탭과 패널을 aria-controls·aria-labelledby로 연결한다', () => {
    render(<Harness />)

    const tab = screen.getByRole('tab', { name: '첫째' })
    const panel = screen.getByRole('tabpanel')
    expect(tab).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', tab.id)
  })

  // roving tabindex — 탭 묶음 전체가 Tab 키 한 번에 지나가고, 내부 이동은 화살표가 맡는다.
  it('선택된 탭만 탭 순서에 남긴다', () => {
    render(<Tabs idPrefix="t" label="테스트 탭" items={ITEMS} value="two" onChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: '둘째' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: '첫째' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: '셋째' })).toHaveAttribute('tabindex', '-1')
  })

  it('좌우 화살표로 이동하면 그 자리에서 선택되고 포커스도 따라간다', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.tab()
    expect(screen.getByRole('tab', { name: '첫째' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '둘째' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: '둘째' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('two 패널')).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '첫째' })).toHaveFocus()
    expect(screen.getByText('one 패널')).toBeInTheDocument()
  })

  it('양 끝에서 화살표를 누르면 반대쪽 끝으로 돌아간다', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.tab()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '셋째' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '첫째' })).toHaveFocus()
  })

  it('Home·End로 처음과 마지막 탭으로 건너뛴다', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.tab()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: '셋째' })).toHaveFocus()

    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: '첫째' })).toHaveFocus()
  })

  it('탭 묶음과 무관한 키는 가로채지 않는다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Tabs idPrefix="t" label="테스트 탭" items={ITEMS} value="one" onChange={onChange} />)

    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(onChange).not.toHaveBeenCalled()
  })
})
