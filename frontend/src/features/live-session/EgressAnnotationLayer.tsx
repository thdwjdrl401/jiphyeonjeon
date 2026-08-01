import { useCallback, useEffect, useRef, useState } from 'react'
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
import { AnnotationOpBuffer, applyPulledDocument, pullAnnotationDocument } from './annotationPull'
import EgressLaserTrail from './EgressLaserTrail'
import { loadExcalidraw } from './excalidrawRuntime'

interface EgressAnnotationLayerProps {
  room: Room | null
  /**
   * Egress를 열 때 받은 LiveKit 액세스 토큰. 전체 상태를 서버에서 받아갈 때 <b>이 방의 참가자</b>임을
   * 증명하는 데 쓴다(ADR-0055 결정 4).
   *
   * <p>없으면 받아가지 않는다 — 그때는 강사가 내는 스냅샷이 유일한 경로다.
   */
  livekitToken?: string
}

/** 방 이름은 `session-{sessionId}`다(백엔드 `LiveSessionService.roomName`과 같은 규칙). */
function sessionIdOf(room: Room | null): string | null {
  const name = room?.name ?? ''
  return name.startsWith('session-') ? name.slice('session-'.length) : null
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
export default function EgressAnnotationLayer({ room, livekitToken }: EgressAnnotationLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [document, setDocument] = useState<AnnotationDocument>(emptyAnnotationDocument)

  /**
   * 지금 화면이 그리고 있는 문서. state와 나란히 ref로도 들고 있는다 — 한 tick에 op가 여러 개
   * 도착하면 state는 아직 이전 값이라, 그것을 기준으로 적용하면 앞의 op가 사라진다.
   */
  const documentRef = useRef<AnnotationDocument>(document)
  const commit = useCallback((next: AnnotationDocument) => {
    documentRef.current = next
    setDocument(next)
  }, [])

  /** 전체 상태를 받아오는 동안 흐른 op를 담아 둔다(ADR-0055). */
  const bufferRef = useRef(new AnnotationOpBuffer())
  /** 받아오기가 겹칠 때 마지막 것만 반영하기 위한 표. */
  const pullSeqRef = useRef(0)

  // 데이터 채널 수신. 판서가 없는 강의에서는 이 훅이 아무 일도 하지 않는다.
  useEffect(() => {
    if (!room) return undefined
    const buffer = bufferRef.current
    let disposed = false

    /**
     * 포인터를 받았다 — 전체 상태는 서버에 있다(ADR-0055).
     *
     * <p><b>버퍼를 먼저 연다.</b> 왕복이 도는 동안에도 강사는 계속 그리고 있고, 그 op를 놓치면
     * 이어붙일 자리가 비어 <b>그 뒤 op가 전부 버려진다</b>.
     */
    const pull = async (pointerRevision: number) => {
      const sessionId = sessionIdOf(room)
      if (!sessionId || !livekitToken) {
        // 받아갈 수단이 없다. 포인터를 무시하고 지금 문서로 버틴다 — 강사가 저장 실패를 만나면
        // 예전처럼 스냅샷을 밀어 준다.
        console.warn('판서 전체 상태를 받아갈 수 없습니다(방 이름 또는 토큰 없음).')
        return
      }
      const seq = (pullSeqRef.current += 1)
      buffer.start()
      const pulled = await pullAnnotationDocument({ sessionId, livekitToken })
      // 그 사이 새 포인터가 왔다면 이 결과는 낡았다. 그쪽이 버퍼를 이미 다시 열었으므로 손대지 않는다.
      if (disposed || seq !== pullSeqRef.current) return

      if (!pulled) {
        /*
         * 받아오지 못했다. 그래도 <b>번호는 맞춘다.</b> 지금까지 그린 판서는 잃지만, 이걸 하지
         * 않으면 이후 델타가 전부 "중간이 빠졌다"로 버려져 강의가 끝날 때까지 아무것도 나타나지
         * 않는다 — 그쪽이 훨씬 나쁘다.
         */
        console.warn('판서 전체 상태를 받아오지 못했습니다 — 번호만 맞추고 이후 판서를 이어 그립니다.')
        commit(buffer.drainOnto({ ...documentRef.current, revision: pointerRevision }))
        return
      }
      commit(buffer.drainOnto(applyPulledDocument(pulled, pointerRevision)))
    }

    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== ANNOTATION_TOPIC) return
      const op = decodeAnnotationOp(payload)
      // 해석할 수 없는 payload는 버린다. 여기서 예외가 나면 녹화 중 화면이 멈출 수 있다.
      if (!op) return

      if (op.type === 'pointer') {
        void pull(op.revision)
        return
      }
      // 받아오는 중이면 쌓아 둔다. 지금 적용하면 곧 도착할 문서가 덮어써 사라진다.
      if (buffer.push(op)) return

      const current = documentRef.current
      const { document: next, stale } = applyAnnotationOp(current, op)
      if (stale) {
        // 유실을 조용히 넘기지 않는다. 강사가 새 참가자에게 내는 포인터가 상태를 맞춰 줄 것이다.
        console.warn(`판서 op를 건너뛰었다(revision ${current.revision} → ${op.revision}) — 전체 상태를 기다린다`)
      }
      commit(next)
    }

    room.on(RoomEvent.DataReceived, onData)
    return () => {
      disposed = true
      // 열린 채로 남기지 않는다. 다시 구독했을 때 op를 쌓기만 하고 그리지 않게 된다.
      buffer.close()
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [commit, livekitToken, room])

  /**
   * 문서 하나를 캔버스로 그려 얹는다.
   *
   * <p>Excalidraw 청크는 <b>첫 판서 op가 도착할 때</b> 내려온다 — 판서를 쓰지 않는 강의에서
   * Egress가 +309KB를 지불할 이유가 없다.
   */
  const renderOnce = useCallback(async (current: AnnotationDocument) => {
    const elements = visibleAnnotationElements(current)
    const host = hostRef.current
    if (!host) return

    if (elements.length === 0) {
      host.replaceChildren()
      return
    }

    try {
      const { exportToCanvas, getCommonBounds } = await loadExcalidraw()

      // 오프셋을 export와 같은 근거(실제 geometry)로 읽는다. 선언된 x/y/width/height를 쓰면
      // freedraw의 points가 그 bbox를 넘어갈 때 어긋난다.
      const bounds = getCommonBounds(elements as never) as readonly [number, number, number, number]
      const canvas = await exportToCanvas({
        elements: elements as never,
        appState: { exportBackground: false },
        /*
         * 이미지 요소는 데이터를 담지 않고 `fileId`로 가리키기만 한다. 여기에 파일을 넘기지 않으면
         * 수식(ADR-0054)이 <b>빈 자리로</b> 합성된다 — 강사 화면에는 보이는데 수강생과 녹화에는
         * 없는, 이 프로젝트에서 반복해 겪은 그 어긋남이다.
         */
        files: current.files as never,
        exportPadding: 0,
        // scale 1은 확대가 아니라 "내용 크기 그대로"를 뜻한다. 캔버스가 내용만큼만 생겨
        // 늘 1920x1080을 할당하는 것보다 싸다.
        getDimensions: (width: number, height: number) => ({ width, height, scale: 1 }),
      })

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
  }, [])

  const latestRef = useRef(document)
  const busyRef = useRef(false)
  const dirtyRef = useRef(false)
  const disposedRef = useRef(false)
  useEffect(() => {
    disposedRef.current = false
    return () => { disposedRef.current = true }
  }, [])

  /**
   * 문서가 바뀌면 다시 그리되, <b>한 번에 하나만</b> 그리고 중간 상태는 건너뛴다.
   *
   * <p>op 하나마다 그리면 밀린다. 획 하나를 긋는 동안 Excalidraw는 점이 늘 때마다 `onChange`를 부르고,
   * 실측한 op 도착 간격은 <b>33.6ms</b>였다(40건 / 1.35초). 그런데 `exportToCanvas`는 문서 전체를 매번
   * 다시 그려 획 50개에 32.5ms, 200개에 55.1ms가 든다(ADR-0051 실측). 판서가 조금만 쌓여도 그리는
   * 시간이 도착 간격을 넘어서고, 그때부터 <b>렌더가 op마다 밀려 쌓인다</b> — 획을 그을수록 수강생
   * 화면이 뒤처지고 획을 멈춰야 따라잡는다.
   *
   * <p>중간 상태를 버려도 잃는 것이 없다. 어차피 다음 op가 곧 덮어쓸 그림이고, 마지막 상태는 반드시
   * 그린다. 이렇게 두면 지연이 <b>export 한 번</b>으로 묶이고 쌓이지 않는다.
   */
  useEffect(() => {
    latestRef.current = document
    dirtyRef.current = true
    if (busyRef.current) return
    busyRef.current = true
    void (async () => {
      try {
        while (dirtyRef.current && !disposedRef.current) {
          dirtyRef.current = false
          await renderOnce(latestRef.current)
        }
      } finally {
        busyRef.current = false
      }
    })()
  }, [document, renderOnce])

  return (
    <>
      <div ref={hostRef} className="egress-stage__annotation" aria-hidden="true" />
      <EgressLaserTrail room={room} />
    </>
  )
}
