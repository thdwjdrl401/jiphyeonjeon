import { useRef, type KeyboardEvent } from 'react'

export interface TabItem<T extends string = string> {
  id: T
  label: string
}

export function tabButtonId(idPrefix: string, tabId: string) {
  return `${idPrefix}-tab-${tabId}`
}

export function tabPanelId(idPrefix: string, tabId: string) {
  return `${idPrefix}-panel-${tabId}`
}

/**
 * 이미 있는 패널 요소에 그대로 펼쳐 넣는 tabpanel 속성.
 * 감싸는 div를 만들지 않으므로 flex·스크롤 레이아웃을 건드리지 않는다.
 */
export function tabPanelProps(idPrefix: string, tabId: string) {
  return {
    role: 'tabpanel' as const,
    id: tabPanelId(idPrefix, tabId),
    'aria-labelledby': tabButtonId(idPrefix, tabId),
    tabIndex: 0,
  }
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[]
  value: T
  onChange: (value: T) => void
  /** 한 화면에 탭 묶음이 둘 이상일 때 id가 겹치지 않게 하는 접두사. tabPanelProps에도 같은 값을 넘긴다. */
  idPrefix: string
  /** 스크린리더가 이 탭 묶음을 부르는 이름. */
  label: string
  className?: string
}

/**
 * ARIA 탭 패턴의 tablist. 선택된 탭만 탭 순서에 두고(roving tabindex) 좌우 화살표로 이동한다.
 *
 * <p>이동과 동시에 선택되는 자동 활성화 방식이다 — 패널 전환이 로컬 상태 교체뿐이라
 * 화살표로 훑는 비용이 낮고, Enter를 한 번 더 누르게 할 이유가 없다.
 */
export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
  label,
  className = '',
}: TabsProps<T>) {
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.id === value)
    if (current < 0) return

    let nextIndex: number
    if (event.key === 'ArrowRight') nextIndex = (current + 1) % items.length
    else if (event.key === 'ArrowLeft') nextIndex = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else return

    event.preventDefault()
    const next = items[nextIndex]
    onChange(next.id)
    tabRefs.current[next.id]?.focus()
  }

  return (
    <div className={className} role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node
            }}
            id={tabButtonId(idPrefix, item.id)}
            className={selected ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
