import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clampOffset,
  cropOutputSize,
  displaySize,
  frameSizeFor,
  toSourceRect,
  type Offset,
  type Size,
} from './thumbnailCrop'

interface CurriculumImageCropDialogProps {
  /** 방금 고른 원본 파일. 이 파일을 잘라 새 파일로 만든다. */
  file: File
  /** 원본을 읽어 둔 data URL. 파일을 두 번 읽지 않으려고 넘겨받는다. */
  sourceUrl: string
  onConfirm: (cropped: File) => void
  onCancel: () => void
}

const FRAME_WIDTH = 496
const MAX_ZOOM = 3
/** 잘라 낸 결과의 형식. 원본이 PNG여도 사진이 대부분이라 JPEG로 저장해 용량을 줄인다. */
const OUTPUT_TYPE = 'image/jpeg'
const OUTPUT_QUALITY = 0.92

/** 파일 이름은 유지하되 확장자만 결과 형식에 맞춘다 — 목록에서 무엇을 올렸는지 알아볼 수 있게. */
function croppedFileName(original: string): string {
  return `${original.replace(/\.[^./\\]+$/, '')}.jpg`
}

/**
 * 대표 이미지를 <b>16:9로 잘라</b> 올린다. 목록 카드가 16:9이고, 상세 히어로는 그보다 세로로 긴
 * 틀이라 좌우가 조금 잘린다(ADR-0087) — 두 화면 중 여러 개가 나란히 놓이는 목록을 기준으로 삼았다.
 *
 * <p>자르는 일을 <b>브라우저에서</b> 한다. 잘린 파일을 그대로 올리므로 서버 계약이 그대로다
 * (기존 THUMBNAIL 에셋 업로드). 크롭 좌표를 저장하려면 응답·DB·표시 지점이 모두 바뀐다.
 *
 * <p>확대는 1배(꼭 맞게 채운 상태)부터다. 그보다 작게 두면 틀에 빈 자리가 생기고, 그 상태로
 * 저장하면 잘린 이미지에 빈 띠가 들어간다.
 */
export default function CurriculumImageCropDialog({
  file,
  sourceUrl,
  onConfirm,
  onCancel,
}: CurriculumImageCropDialogProps) {
  const frame = frameSizeFor(FRAME_WIDTH)
  const [natural, setNatural] = useState<Size | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; from: Offset } | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onCancel()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isSaving, onCancel])

  /* 이미지가 로드되면 가운데를 보여 준다 — 강사가 고른 사진의 한가운데가 기본값으로 자연스럽다. */
  const centerImage = useCallback((size: Size, nextZoom: number) => {
    const display = displaySize(size, frame, nextZoom)
    setOffset(clampOffset(display, frame, {
      x: (frame.width - display.width) / 2,
      y: (frame.height - display.height) / 2,
    }))
  }, [frame])

  const changeZoom = (nextZoom: number) => {
    setZoom(nextZoom)
    if (!natural) return
    /*
      확대 배율이 바뀌면 틀 중앙이 가리키던 지점을 그대로 붙잡는다. 이동량을 그냥 두면
      확대할 때마다 그림이 좌상단으로 쏠려 방금 맞춘 자리가 흐트러진다.
    */
    const before = displaySize(natural, frame, zoom)
    const after = displaySize(natural, frame, nextZoom)
    const centerRatioX = (frame.width / 2 - offset.x) / before.width
    const centerRatioY = (frame.height / 2 - offset.y) / before.height
    setOffset(clampOffset(after, frame, {
      x: frame.width / 2 - centerRatioX * after.width,
      y: frame.height / 2 - centerRatioY * after.height,
    }))
  }

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!natural || isSaving) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: offset }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || !natural || drag.pointerId !== event.pointerId) return
    const display = displaySize(natural, frame, zoom)
    setOffset(clampOffset(display, frame, {
      x: drag.from.x + (event.clientX - drag.startX),
      y: drag.from.y + (event.clientY - drag.startY),
    }))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  /** 방향키로도 자리를 맞출 수 있어야 한다 — 드래그만 두면 키보드로는 크롭을 정할 수 없다. */
  const nudge = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!natural) return
    const step = event.shiftKey ? 20 : 4
    const moves: Record<string, Offset> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    const display = displaySize(natural, frame, zoom)
    setOffset(clampOffset(display, frame, { x: offset.x + move.x, y: offset.y + move.y }))
  }

  const confirm = async () => {
    if (!natural || isSaving) return
    setIsSaving(true)
    setError('')
    try {
      const source = toSourceRect(natural, frame, zoom, offset)
      const output = cropOutputSize(source)
      const canvas = document.createElement('canvas')
      canvas.width = output.width
      canvas.height = output.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas 2d context를 열지 못했습니다.')

      const image = new Image()
      image.src = sourceUrl
      // data URL이라 네트워크를 타지 않지만, decode 전에 그리면 빈 캔버스가 저장된다.
      if (image.decode) await image.decode()
      context.drawImage(image, source.sx, source.sy, source.sw, source.sh, 0, 0, output.width, output.height)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY))
      if (!blob) throw new Error('잘라 낸 이미지를 만들지 못했습니다.')
      onConfirm(new File([blob], croppedFileName(file.name), { type: OUTPUT_TYPE }))
    } catch {
      setError('이미지를 자르지 못했습니다. 다시 시도해 주세요.')
      setIsSaving(false)
    }
  }

  const display = natural ? displaySize(natural, frame, zoom) : null

  return (
    <div
      className="profile-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onCancel()
      }}
    >
      <section
        className="profile-modal thumbnail-crop-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thumbnail-crop-title"
        aria-describedby="thumbnail-crop-lead"
      >
        <header className="profile-modal__header">
          <div>
            <span className="eyebrow">THUMBNAIL</span>
            <h2 id="thumbnail-crop-title">대표 이미지 자르기</h2>
            <p id="thumbnail-crop-lead">
              목록과 상세에서 보일 부분을 정합니다. 끌어서 위치를 맞추고 확대로 범위를 좁히세요.
            </p>
          </div>
          <button
            ref={cancelButtonRef}
            className="profile-modal__close"
            type="button"
            aria-label="대표 이미지 자르기 닫기"
            disabled={isSaving}
            onClick={onCancel}
          >×</button>
        </header>

        <div
          className="thumbnail-crop__frame"
          style={{ width: frame.width, height: frame.height }}
          role="application"
          aria-label="보여줄 범위 — 끌어서 이동, 방향키로 미세 조정"
          tabIndex={0}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={nudge}
        >
          <img
            className="thumbnail-crop__image"
            src={sourceUrl}
            alt=""
            draggable={false}
            style={display
              ? { width: display.width, height: display.height, transform: `translate(${offset.x}px, ${offset.y}px)` }
              : undefined}
            onLoad={(event) => {
              const loaded = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }
              setNatural(loaded)
              centerImage(loaded, 1)
            }}
          />
        </div>

        <label className="thumbnail-crop__zoom">
          <span>확대</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!natural || isSaving}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
          <output>{zoom.toFixed(1)}배</output>
        </label>

        <p className="thumbnail-crop__hint">
          잘린 부분은 저장되지 않습니다. 원본을 다시 올리면 언제든 다르게 자를 수 있어요.
        </p>
        {error && <small className="thumbnail-crop__error" role="alert">{error}</small>}

        <div className="thumbnail-crop__actions">
          <button className="button button--ghost" type="button" disabled={isSaving} onClick={onCancel}>취소</button>
          <button className="button button--primary" type="button" disabled={!natural || isSaving} onClick={() => void confirm()}>
            {isSaving ? '자르는 중' : '이 범위로 등록'}
          </button>
        </div>
      </section>
    </div>
  )
}
