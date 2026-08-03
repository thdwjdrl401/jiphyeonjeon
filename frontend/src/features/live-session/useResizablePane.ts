import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 경계를 끌어 옆(또는 아래) 칸의 크기를 바꾸는 손잡이.
 *
 * <p><b>왜 필요한가.</b> 강의 화면은 영상·자막·사이드패널이 한 화면을 나눠 쓰는데, 무엇을 크게
 * 볼지는 사람마다 다르다. 자막을 따라 읽는 사람과 영상을 크게 보는 사람에게 같은 비율을 강요할
 * 이유가 없다.
 *
 * <p><b>접힘을 크기의 연장으로 둔다.</b> 최소치보다 작게 끌면 0이 되고, 손잡이만 남아 다시 펼 수
 * 있다. 별도의 접기 버튼을 두면 "끝까지 줄였는데 왜 안 없어지지"가 된다 — 끌어서 없애는 것이
 * 사람이 기대하는 동작이다.
 *
 * <p><b>기억한다.</b> 매번 다시 맞추게 하면 조절 기능이 있으나 마나다. 화면(key)별로 남긴다.
 *
 * <p><b>키보드로도 된다.</b> 손잡이는 `separator`라서 방향키로 옮기고 Enter로 접었다 편다 —
 * 드래그만 되면 포인터를 못 쓰는 사람에게는 없는 기능과 같다.
 */
export interface ResizablePane {
  /** 지금 크기(px). 0이면 접힌 것이다. */
  size: number
  collapsed: boolean
  /** 손잡이 엘리먼트에 그대로 펼치는 props. */
  handleProps: {
    role: 'separator'
    tabIndex: 0
    'aria-orientation': 'vertical' | 'horizontal'
    'aria-label': string
    'aria-valuenow': number
    'aria-valuemin': number
    'aria-valuemax': number
    className: string
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
    onDoubleClick: () => void
  }
}

interface Options {
  /** 저장 키. 화면마다 달라야 서로의 설정을 덮어쓰지 않는다. */
  storageKey: string
  /** 처음 크기. 저장된 값이 있으면 그쪽이 이긴다. */
  defaultSize: number
  min: number
  max: number
  /**
   * 손잡이를 끌 때 커지는 방향.
   * `inline`은 좌우(사이드패널 폭), `block`은 위아래(자막 높이)다.
   */
  axis: 'inline' | 'block'
  /**
   * 끄는 방향과 크기 변화의 부호. 사이드패널은 왼쪽으로 끌수록 커지므로 -1이다.
   */
  direction: 1 | -1
  label: string
}

/** 이보다 작아지면 접는다. 최소치의 절반 — 실수로 접히지 않으면서 의도하면 닿는다. */
const collapseRatio = 0.5
/** 방향키 한 번의 이동량. Shift와 함께면 이 값의 4배. */
const keyStep = 16

function readStored(key: string, fallback: number) {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : fallback
  } catch {
    // 사생활 보호 모드 등에서 localStorage가 막힐 수 있다. 기억 못 하는 것은 기능 실패가 아니다.
    return fallback
  }
}

export function useResizablePane(options: Options): ResizablePane {
  const { storageKey, defaultSize, min, max, axis, direction, label } = options
  const [size, setSize] = useState(() => readStored(storageKey, defaultSize))
  // 접힌 상태에서 다시 펼 때 돌아갈 크기. 접기 전 값을 기억해 두지 않으면 항상 기본값으로 돌아간다.
  const lastOpenSize = useRef(size > 0 ? size : defaultSize)

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(size))
    } catch {
      // 저장 실패는 무시한다 — 이번 세션 동안은 그대로 동작한다.
    }
    if (size > 0) lastOpenSize.current = size
  }, [size, storageKey])

  const clamp = useCallback((next: number) => {
    if (next < min * collapseRatio) return 0
    return Math.min(max, Math.max(min, next))
  }, [max, min])

  const toggle = useCallback(() => {
    setSize((current) => (current === 0 ? lastOpenSize.current : 0))
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const startPoint = axis === 'inline' ? event.clientX : event.clientY
    const startSize = size
    // 포인터를 손잡이에 붙잡아 둔다. 안 하면 빠르게 끌었을 때 커서가 벗어나며 드래그가 끊긴다.
    handle.setPointerCapture(event.pointerId)

    const move = (moveEvent: PointerEvent) => {
      const point = axis === 'inline' ? moveEvent.clientX : moveEvent.clientY
      setSize(clamp(startSize + (point - startPoint) * direction))
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }, [axis, clamp, direction, size])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const grow = axis === 'inline' ? 'ArrowLeft' : 'ArrowUp'
    const shrink = axis === 'inline' ? 'ArrowRight' : 'ArrowDown'
    // 방향키의 의미는 축마다 다르다. direction이 -1인 축에서는 "왼쪽 = 크게"가 맞다.
    const step = event.shiftKey ? keyStep * 4 : keyStep
    if (event.key === grow || event.key === shrink) {
      event.preventDefault()
      const delta = (event.key === grow ? 1 : -1) * (direction === -1 ? 1 : -1) * step
      setSize((current) => clamp((current === 0 ? 0 : current) + delta))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }, [axis, clamp, direction, toggle])

  return {
    size,
    collapsed: size === 0,
    handleProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': axis === 'inline' ? 'vertical' : 'horizontal',
      'aria-label': label,
      'aria-valuenow': size,
      'aria-valuemin': 0,
      'aria-valuemax': max,
      className: `pane-handle pane-handle--${axis}${size === 0 ? ' is-collapsed' : ''}`,
      onPointerDown,
      onKeyDown,
      onDoubleClick: toggle,
    },
  }
}
