import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  MAX_OVERLAY_WIDTH,
  MIN_OVERLAY_WIDTH,
  overlayHeight,
  type CameraOverlay,
} from './cameraOverlay'

interface CameraOverlayControlProps {
  overlay: CameraOverlay
  onChange: (next: Partial<CameraOverlay>) => void
  /** 오버레이 안에 그릴 카메라 미리보기. */
  children: React.ReactNode
  disabled?: boolean
}

/** 키보드 한 번에 움직이는 폭(비율). 화면 1/50 — 여러 번 눌러 미세 조정할 수 있는 크기다. */
const NUDGE = 0.02
const RESIZE_STEP = 0.02

/**
 * 합성 화면에서 카메라가 놓일 자리를 강사가 직접 정한다.
 *
 * <p>여기서 옮긴 위치가 그대로 수강생이 보는 녹화가 된다 — 미리보기와 합성이 같은 값(0~1 비율)을
 * 읽기 때문이다. 그래서 이 컴포넌트는 "미리보기 장식"이 아니라 실제 출력 편집기다.
 *
 * <p>포인터 드래그와 키보드 조작을 모두 받는다. 드래그만 지원하면 키보드 사용자가 배치를 바꿀 수 없다.
 */
export default function CameraOverlayControl({ overlay, onChange, children, disabled }: CameraOverlayControlProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{ pointerId: number; startX: number; startW: number; frameWidth: number } | null>(null)
  const [interacting, setInteracting] = useState(false)

  const height = overlayHeight(overlay.w)

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    const frame = frameRef.current
    if (!frame) return
    const bounds = frame.getBoundingClientRect()
    // 잡은 지점과 오버레이 좌상단의 차이를 기억한다. 이게 없으면 드래그 시작 순간
    // 오버레이가 커서 위치로 튄다.
    dragRef.current = {
      pointerId: event.pointerId,
      dx: (event.clientX - bounds.left) / bounds.width - overlay.x,
      dy: (event.clientY - bounds.top) / bounds.height - overlay.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteracting(true)
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    const frame = frameRef.current
    if (!frame) return
    event.stopPropagation()
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startW: overlay.w,
      frameWidth: frame.getBoundingClientRect().width,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteracting(true)
  }

  const handleMove = useCallback((event: PointerEvent) => {
    const frame = frameRef.current
    if (!frame) return
    const bounds = frame.getBoundingClientRect()

    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId) {
      onChange({
        x: (event.clientX - bounds.left) / bounds.width - drag.dx,
        y: (event.clientY - bounds.top) / bounds.height - drag.dy,
      })
      return
    }
    const resize = resizeRef.current
    if (resize && resize.pointerId === event.pointerId) {
      onChange({ w: resize.startW + (event.clientX - resize.startX) / resize.frameWidth })
    }
  }, [onChange])

  const endInteraction = useCallback((event: PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null
    if (!dragRef.current && !resizeRef.current) setInteracting(false)
  }, [])

  // 포인터가 프레임 밖으로 나가도 계속 따라와야 한다. 창 전체에서 받는다.
  useEffect(() => {
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', endInteraction)
    window.addEventListener('pointercancel', endInteraction)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', endInteraction)
      window.removeEventListener('pointercancel', endInteraction)
    }
  }, [endInteraction, handleMove])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const step = event.shiftKey ? NUDGE * 3 : NUDGE
    const moves: Record<string, Partial<CameraOverlay>> = {
      ArrowLeft: { x: overlay.x - step },
      ArrowRight: { x: overlay.x + step },
      ArrowUp: { y: overlay.y - step },
      ArrowDown: { y: overlay.y + step },
      '+': { w: overlay.w + RESIZE_STEP },
      '=': { w: overlay.w + RESIZE_STEP },
      '-': { w: overlay.w - RESIZE_STEP },
    }
    const next = moves[event.key]
    if (!next) return
    event.preventDefault()
    onChange(next)
  }

  if (!overlay.visible) return null

  return (
    <div className="camera-overlay-frame" ref={frameRef}>
      <div
        className={`camera-overlay${interacting ? ' is-interacting' : ''}${disabled ? ' is-locked' : ''}`}
        style={{
          left: `${overlay.x * 100}%`,
          top: `${overlay.y * 100}%`,
          width: `${overlay.w * 100}%`,
          height: `${height * 100}%`,
        }}
        role="group"
        aria-label="합성 화면의 카메라 위치"
        tabIndex={disabled ? -1 : 0}
        onPointerDown={beginDrag}
        onKeyDown={handleKeyDown}
      >
        {children}
        <span className="camera-overlay__hint" aria-hidden="true">끌어서 이동 · 방향키로 미세 조정</span>
        <button
          type="button"
          className="camera-overlay__resize"
          aria-label={`카메라 크기 조절 (현재 화면 폭의 ${Math.round(overlay.w * 100)}%)`}
          aria-valuenow={Math.round(overlay.w * 100)}
          aria-valuemin={Math.round(MIN_OVERLAY_WIDTH * 100)}
          aria-valuemax={Math.round(MAX_OVERLAY_WIDTH * 100)}
          role="slider"
          disabled={disabled}
          onPointerDown={beginResize}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            // 부모(이동 조작)로 올라가면 한 번 눌러 크기와 위치가 동시에 바뀐다.
            event.stopPropagation()
            onChange({ w: overlay.w + (event.key === 'ArrowRight' ? RESIZE_STEP : -RESIZE_STEP) })
          }}
        />
      </div>
    </div>
  )
}
