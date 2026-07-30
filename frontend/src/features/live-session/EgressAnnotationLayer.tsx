import { useEffect, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import {
  ANNOTATION_TOPIC,
  annotationPlacement,
  applyAnnotationOp,
  decodeAnnotationOp,
  emptyAnnotationDocument,
  visibleAnnotationElements,
  type AnnotationDocument,
} from './annotation'
import EgressLaserTrail from './EgressLaserTrail'
import { loadExcalidraw } from './excalidrawRuntime'

interface EgressAnnotationLayerProps {
  room: Room | null
}

/**
 * Egress 합성 화면의 판서 레이어(ADR-0051).
 *
 * <p><b>에디터를 마운트하지 않는다.</b> `exportToCanvas`로 요소 배열만 렌더한다. 덕분에 선택 핸들·
 * 툴바가 녹화에 새는 문제가 원천적으로 없다 — `viewModeEnabled`로 UI를 숨기는 접근은 "무엇이
 * 숨겨지는지"를 버전마다 다시 검증해야 하지만, 여기에는 그릴 UI가 애초에 없다.
 *
 * <p><b>프레임마다 다시 그리지 않는다.</b> Egress 합성은 캔버스 루프가 아니라 DOM 합성이다 —
 * 헤드리스 Chrome이 이 페이지를 그대로 캡처하므로, 문서가 바뀔 때만 캔버스를 갈아 끼우면 나머지는
 * Chrome 컴포지터가 한다. 요소 200개 export가 55ms라 프레임 예산(33ms)을 넘기므로 매 프레임
 * 렌더하는 설계는 애초에 불가능하다.
 *
 * <p><b>위치는 오프셋을 보정해 잡는다.</b> `exportToCanvas`는 프레임이 아니라 내용 바운딩 박스를
 * 기준으로 그리므로, 획이 늘 때마다 원점이 움직인다. `getCommonBounds`로 실제 오프셋을 읽어
 * 보정하지 않으면 판서가 영상 대비 밀린다 — 그런데 <b>강사 화면에서는 정상으로 보이고 녹화에서만
 * 어긋난다</b>.
 */
export default function EgressAnnotationLayer({ room }: EgressAnnotationLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [document, setDocument] = useState<AnnotationDocument>(emptyAnnotationDocument)

  // 데이터 채널 수신. 판서가 없는 강의에서는 이 훅이 아무 일도 하지 않는다.
  useEffect(() => {
    if (!room) return undefined

    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== ANNOTATION_TOPIC) return
      const op = decodeAnnotationOp(payload)
      // 해석할 수 없는 payload는 버린다. 여기서 예외가 나면 녹화 중 화면이 멈출 수 있다.
      if (!op) return
      setDocument((current) => {
        const { document: next, stale } = applyAnnotationOp(current, op)
        if (stale) {
          // 유실을 조용히 넘기지 않는다. 강사가 새 참가자에게 보내는 스냅샷이 상태를 맞춰 줄 것이다.
          console.warn(`판서 op를 건너뛰었다(revision ${current.revision} → ${op.revision}) — 스냅샷을 기다린다`)
        }
        return next
      })
    }

    room.on(RoomEvent.DataReceived, onData)
    return () => { room.off(RoomEvent.DataReceived, onData) }
  }, [room])

  /**
   * 문서가 바뀔 때만 다시 렌더한다.
   *
   * <p>Excalidraw 청크는 <b>첫 판서 op가 도착할 때</b> 내려온다 — 판서를 쓰지 않는 강의에서
   * Egress가 +309KB를 지불할 이유가 없다.
   */
  useEffect(() => {
    const elements = visibleAnnotationElements(document)
    const host = hostRef.current
    if (!host) return undefined

    if (elements.length === 0) {
      host.replaceChildren()
      return undefined
    }

    let cancelled = false
    void (async () => {
      try {
        const { exportToCanvas, getCommonBounds } = await loadExcalidraw()
        if (cancelled) return

        // 오프셋을 export와 같은 근거(실제 geometry)로 읽는다. 선언된 x/y/width/height를 쓰면
        // freedraw의 points가 그 bbox를 넘어갈 때 어긋난다.
        const bounds = getCommonBounds(elements as never) as readonly [number, number, number, number]
        const canvas = await exportToCanvas({
          elements: elements as never,
          appState: { exportBackground: false },
          files: null,
          exportPadding: 0,
          // scale 1은 확대가 아니라 "내용 크기 그대로"를 뜻한다. 캔버스가 내용만큼만 생겨
          // 늘 1920x1080을 할당하는 것보다 싸다.
          getDimensions: (width: number, height: number) => ({ width, height, scale: 1 }),
        })
        if (cancelled) return

        const placement = annotationPlacement(bounds, canvas)
        canvas.style.position = 'absolute'
        canvas.style.left = `${placement.x * 100}%`
        canvas.style.top = `${placement.y * 100}%`
        canvas.style.width = `${placement.w * 100}%`
        canvas.style.height = `${placement.h * 100}%`
        host.replaceChildren(canvas)
      } catch (error) {
        // 판서를 잃는 것과 녹화가 끊기는 것은 비교할 수 없다. 이전 화면을 그대로 두고 넘어간다.
        console.error('판서를 합성 화면에 렌더하지 못했습니다', error)
      }
    })()

    return () => { cancelled = true }
  }, [document])

  return (
    <>
      <div ref={hostRef} className="egress-stage__annotation" aria-hidden="true" />
      <EgressLaserTrail room={room} />
    </>
  )
}
