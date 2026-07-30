import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import {
  WHITEBOARD_ELEMENT_ID,
  annotationStageScale,
  diffAnnotationElements,
  laserPointFromPointer,
  whiteboardElement,
  type AnnotationChange,
  type AnnotationElement,
  type LaserPoint,
  type LaserStroke,
} from './annotation'
import { loadExcalidraw, type ExcalidrawModule } from './excalidrawRuntime'

/**
 * 판서 기본 색. 강의 화면은 대체로 밝은 슬라이드거나 어두운 코드 에디터인데, Excalidraw 기본
 * 먹색(#1e1e1e)은 후자에서 사실상 보이지 않는다. 빨강은 둘 다에서 읽힌다.
 */
const DEFAULT_STROKE_COLOR = '#e03131'

/**
 * 우리가 쓰는 Excalidraw 명령형 API만 좁게 선언한다. 패키지의 내부 타입 경로는 버전마다 움직이는데,
 * 여기서 그 경로에 의존하면 업그레이드가 이 파일의 컴파일을 깨뜨린다.
 */
interface ExcalidrawApi {
  updateScene: (scene: { elements?: readonly AnnotationElement[]; appState?: Record<string, unknown> }) => void
  getAppState: () => {
    zoom?: { value: number }
    scrollX?: number
    scrollY?: number
    activeTool?: { type?: string }
  }
  getSceneElements: () => readonly AnnotationElement[]
}

interface InstructorAnnotationLayerProps {
  /** 판서를 켜 둔 동안만 mount한다. 껐을 때 무거운 에디터를 붙여 둘 이유가 없다. */
  active: boolean
  /** 판서 변경을 데이터 채널로 내보낸다. */
  onPublish: (change: AnnotationChange) => void
  /** 새 참가자가 들어올 때마다 오르는 값. 오르면 스냅샷을 다시 내보낸다. */
  audienceRevision: number
  /**
   * 속성 패널(색·굵기·투명도)을 펼칠지. 기본은 접어 둔다 — 자료 위에 그리는 화면에서 좌우 패널이
   * 시야를 가리고, 색·굵기는 매 획마다 바꾸는 것이 아니다.
   *
   * <p>구현은 Excalidraw의 zen 모드다(정식 prop). 켜면 좌우 패널과 Library가 화면 밖으로 밀리고
   * 도구 툴바만 남는다.
   */
  showPropertyPanel: boolean
  /**
   * 프레임 전체를 덮는 흰 판을 깔지. 화면공유 없이 판서만 할 때 쓴다.
   *
   * <p>배경색(appState)이 아니라 <b>맨 뒤에 놓인 잠긴 요소</b>로 구현한다 — 기존 op 경로를 그대로 타서
   * Egress에도 아무 변경 없이 나간다.
   */
  whiteboard: boolean
  /**
   * 레이저 획을 내보낸다. 판서 op와 다른 경로다(lossy, 별도 topic).
   *
   * <p><b>포인터를 누르고 있는 동안만</b> 나간다 — Excalidraw가 그렇게 동작하므로 그냥 마우스를
   * 움직이는 것으로는 아무것도 그려지지 않아야 한다.
   */
  onLaser: (stroke: LaserStroke) => void
  /**
   * 서버에 저장돼 있던 판서(ADR-0051). 강사가 새로고침한 뒤 에디터를 이걸로 되살린다.
   *
   * <p>아직 불러오지 못했으면 null. 빈 배열과 다르다 — 빈 배열로 seed해 버리면 나중에 도착한
   * 복원본이 무시되거나, 반대로 강사가 그 사이 그린 획을 덮는다.
   */
  restoredElements: AnnotationElement[] | null
}

/**
 * 강사 판서 레이어. 합성 캔버스(16:9) 위에 Excalidraw 에디터를 얹는다(ADR-0051).
 *
 * <p><b>여기가 편집 가능한 원본이다.</b> Egress는 같은 문서를 읽기 전용으로 렌더하고, 수강생은 그
 * 합성 결과만 본다(ADR-0032). 그래서 강사만 도구·선택 핸들을 보고, 녹화에는 그림만 나간다.
 *
 * <p><b>문서를 Excalidraw 요소로 두는 이유.</b> 다음 단계에서 손그림을 AI로 인식해 실제 도형으로
 * 바꿀 때, 결과가 이미지가 아니라 <b>다시 늘리고 줄이고 고칠 수 있는 객체</b>여야 한다. Excalidraw
 * 요소로 만들어 넣으면 그 편집 기능이 그대로 따라온다.
 *
 * <p><b>배경을 투명하게 둔다.</b> 이 레이어 아래에 화면공유 영상이 깔린다. Excalidraw의 기본 흰
 * 배경을 그대로 쓰면 영상을 덮어버린다.
 */
export default function InstructorAnnotationLayer({
  active,
  onPublish,
  audienceRevision,
  showPropertyPanel,
  whiteboard,
  onLaser,
  restoredElements,
}: InstructorAnnotationLayerProps) {
  /**
   * 에디터 컴포넌트와 메뉴 조립에 쓰는 `MainMenu`를 함께 들고 있는다. 둘 다 같은 지연 청크에서 오므로
   * 하나만 준비된 상태가 없다.
   */
  const [ui, setUi] = useState<{
    Excalidraw: ComponentType<Record<string, unknown>>
    MainMenu: ExcalidrawModule['MainMenu']
  } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  /** 지금까지 내보낸 요소의 `id → version`. 바뀐 것만 골라내는 기준이다. */
  const knownRef = useRef(new Map<string, number>())
  /** 마지막으로 본 전체 요소. 스냅샷을 다시 낼 때 쓴다. */
  const elementsRef = useRef<AnnotationElement[]>([])

  /**
   * 논리 프레임(1920x1080)을 컨테이너에 매핑하는 zoom을 유지한다.
   *
   * <p>컨테이너 크기가 바뀔 때마다 다시 잰다 — 창 크기 변경과 전체화면 전환이 모두 이 경로로
   * 처리된다. `scroll`도 0으로 되돌린다: 강사가 실수로 캔버스를 밀면 보는 자리와 나가는 자리가
   * 달라지는데, 강사 화면에서는 그게 드러나지 않는다.
   */
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ExcalidrawApi | null>(null)

  const applyFrameMapping = useCallback(() => {
    const host = hostRef.current
    const api = apiRef.current
    if (!host || !api) return
    const rect = host.getBoundingClientRect()
    const zoom = annotationStageScale({ width: rect.width, height: rect.height })
    if (zoom <= 0) return
    const state = api.getAppState()
    if (state.zoom?.value === zoom && state.scrollX === 0 && state.scrollY === 0) return
    api.updateScene({ appState: { zoom: { value: zoom }, scrollX: 0, scrollY: 0 } })
  }, [])

  const handleApi = useCallback((api: ExcalidrawApi) => {
    apiRef.current = api
    applyFrameMapping()
  }, [applyFrameMapping])

  useEffect(() => {
    const host = hostRef.current
    if (!active || !host) return undefined
    applyFrameMapping()
    const observer = new ResizeObserver(applyFrameMapping)
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [active, applyFrameMapping])


  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadExcalidraw()
      .then((module) => {
        if (cancelled) return
        // 컴포넌트를 state에 담을 때는 반드시 함수로 감싼다. 그냥 넘기면 React가 <b>업데이터 함수</b>로
        // 보고 컴포넌트를 호출해 그 반환값(JSX)을 state에 넣는다 — 렌더에서 "Element type is invalid"로
        // 터진다.
        setUi(() => ({
          Excalidraw: module.Excalidraw as unknown as ComponentType<Record<string, unknown>>,
          MainMenu: module.MainMenu,
        }))
      })
      .catch((error) => {
        if (cancelled) return
        // 판서를 못 켜는 것으로 끝낸다. 강의 송출 자체는 계속되어야 한다.
        console.error('판서 편집기를 불러오지 못했습니다', error)
        setLoadFailed(true)
      })
    return () => { cancelled = true }
  }, [active])

  /**
   * Excalidraw는 `onChange`로 <b>매번 전체 요소 배열</b>을 준다(diff가 아니다). 그대로 실어 보내면
   * 판서가 쌓일수록 획 하나가 수백 KB가 되므로, 요소의 `version`을 비교해 바뀐 것만 보낸다.
   */
  const handleChange = useCallback((elements: readonly AnnotationElement[]) => {
    // 스크롤·확대가 조금이라도 밀리면 되돌린다. 판서는 영상 위에 얹히므로 캔버스가 밀리는 순간
    // 강사가 보는 자리와 합성에 나가는 자리가 갈린다 — 그런데 강사 화면에서는 정상으로 보인다.
    // 입력을 막는 것(handleWheel/키보드)이 1차 방어고, 이건 그것을 빠져나간 경우의 2차 방어다.
    applyFrameMapping()

    elementsRef.current = elements.filter((element) => element.isDeleted !== true)
    const { changes, known } = diffAnnotationElements(knownRef.current, elements)
    knownRef.current = known
    for (const change of changes) onPublish(change)
  }, [applyFrameMapping, onPublish])

  /**
   * 저장돼 있던 판서를 에디터에 되돌린다(ADR-0051). 새로고침해도 강사 화면이 수강생 화면과 같아야
   * 하는데, Egress는 자기 문서를 계속 들고 있으므로 되살리지 않으면 강사만 빈 화면을 본다.
   *
   * <p>한 번만 한다. 그리고 강사가 이미 그렸다면 하지 않는다 — 복원이 늦게 도착해 방금 그린 획을
   * 덮으면, 그 획은 강사 화면에서 사라지는데 수강생 화면에는 남아 둘이 갈린다.
   *
   * <p>`knownRef`도 함께 채운다. 비워 두면 다음 `onChange`에서 복원된 요소 전부가 "새로 그린 것"으로
   * 잡혀 그대로 다시 나간다.
   */
  const seededRef = useRef(false)
  useEffect(() => {
    const api = apiRef.current
    if (seededRef.current || !api) return
    if (!restoredElements || restoredElements.length === 0) return
    if (elementsRef.current.length > 0) return
    seededRef.current = true
    elementsRef.current = [...restoredElements]
    const known = new Map<string, number>()
    for (const element of restoredElements) known.set(element.id, element.version ?? 0)
    knownRef.current = known
    api.updateScene({ elements: restoredElements })
  }, [restoredElements, ui])

  /**
   * 화이트보드를 깔거나 걷는다.
   *
   * <p>맨 <b>앞</b>에 넣는다 — Excalidraw는 배열 순서를 z-order로 쓰고 앞이 뒤쪽 레이어다. 뒤에 넣으면
   * 판이 이미 그린 획을 덮는다.
   *
   * <p>토글은 요소 추가·제거이므로 `onChange` → diff를 타고 자동으로 Egress에 전달된다. 여기서 직접
   * publish하지 않는다 — 두 경로가 생기면 revision이 어긋난다.
   */
  useEffect(() => {
    const api = apiRef.current
    if (!active || !api) return
    const current = api.getSceneElements()
    const hasBoard = current.some((element) => element.id === WHITEBOARD_ELEMENT_ID)
    if (whiteboard === hasBoard) return
    api.updateScene({
      elements: whiteboard
        ? [whiteboardElement(), ...current]
        : current.filter((element) => element.id !== WHITEBOARD_ELEMENT_ID),
    })
  }, [active, whiteboard, ui])

  /**
   * 확대·이동 입력을 아예 막는다.
   *
   * <p>Excalidraw는 휠 스크롤로 캔버스를 밀고 `Ctrl+휠`로 확대한다. 일반 화이트보드에서는 당연한
   * 동작이지만, 판서는 <b>영상 위에 정확히 겹쳐야</b> 하므로 밀리거나 확대되면 안 된다.
   *
   * <p>`{ passive: false }`로 직접 붙인다 — React의 `onWheel`은 passive로 등록될 수 있어
   * `preventDefault()`가 무시된다.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!active || !host) return undefined
    const block = (event: WheelEvent) => { event.preventDefault() }
    host.addEventListener('wheel', block, { passive: false })
    return () => { host.removeEventListener('wheel', block) }
  }, [active])

  /**
   * 레이저 획을 중계한다.
   *
   * <p>레이저는 Excalidraw에서 <b>scene 요소가 아니다</b> — 사라지는 잔상을 별도 오버레이가 그릴 뿐이라
   * `onChange`에 잡히지 않고, 따라서 판서 op 경로로는 수강생에게 절대 도달하지 않는다. 그래서 포인터
   * 좌표를 직접 주워 별도 경로로 보낸다.
   *
   * <p><b>누르고 있는 동안만 보낸다.</b> Excalidraw는 `button === "down"`일 때만 궤적을 만든다
   * (`laser-trails.ts`). 마우스를 그냥 움직일 때도 보내면 강사 화면에는 아무것도 없는데 수강생
   * 화면에만 궤적이 생긴다.
   *
   * <p>발행은 프레임당 한 번으로 묶는다(`requestAnimationFrame`). 포인터 이벤트는 그보다 자주 오는데
   * 화면은 프레임 단위로만 갱신되므로 더 자주 보낼 이유가 없다.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!active || !host) return undefined

    let drawing = false
    let pending: LaserPoint[] = []
    let frame = 0

    const isLaser = () => apiRef.current?.getAppState().activeTool?.type === 'laser'
    const toPoint = (event: PointerEvent) =>
      laserPointFromPointer(event, host.getBoundingClientRect(), performance.now())

    const flush = (phase: LaserStroke['phase']) => {
      frame = 0
      if (pending.length === 0 && phase !== 'end') return
      // 굵기 보정용 zoom을 함께 보낸다(LaserStroke.zoom 참조).
      const rect = host.getBoundingClientRect()
      onLaser({ phase, points: pending, zoom: annotationStageScale(rect) || 1 })
      pending = []
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!isLaser()) return
      const point = toPoint(event)
      if (!point) return
      drawing = true
      pending = [point]
      flush('start')
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!drawing) return
      const point = toPoint(event)
      if (!point) return
      pending.push(point)
      if (frame === 0) frame = requestAnimationFrame(() => flush('move'))
    }

    const onPointerUp = () => {
      if (!drawing) return
      drawing = false
      if (frame !== 0) { cancelAnimationFrame(frame); frame = 0 }
      flush('end')
    }

    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    // 포인터가 캔버스 밖에서 떨어져도 획은 끝나야 한다 — 안 그러면 궤적이 계속 이어진다.
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [active, onLaser])

  /**
   * 새 참가자(특히 도중에 재접속한 Egress)는 그 전에 흐른 op를 받을 수 없다. 전체 스냅샷을 다시 내
   * 판서가 빈 채로 녹화되는 것을 막는다.
   *
   * <p>첫 렌더에도 한 번 도는데, 그때는 판서가 비어 있어 보낼 것이 없다.
   */
  useEffect(() => {
    if (!active || elementsRef.current.length === 0) return
    onPublish({ type: 'snapshot', elements: elementsRef.current })
  }, [active, audienceRevision, onPublish])

  /**
   * 판서를 끄면 <b>수강생 화면에서도 감춘다.</b>
   *
   * <p>이걸 보내지 않으면 강사 화면에서만 사라지고 Egress는 자기 문서를 계속 렌더한다 — 강사는 껐다고
   * 믿는데 수강생과 녹화에는 남는다. "강사가 보는 화면이 곧 수강생이 보는 화면"이라는 규칙을 어기고,
   * 어긋남이 강사 쪽에서 드러나지 않아 조용히 넘어간다.
   *
   * <p>삭제가 아니라 <b>숨김</b>이다. 문서의 정본은 `elementsRef`가 들고 있어 다시 켜면 위 스냅샷
   * 효과가 그대로 복원한다 — 카메라 배치를 옮기려 잠깐 끄는 것만으로 판서를 잃지 않는다.
   */
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && !active && elementsRef.current.length > 0) {
      onPublish({ type: 'clear' })
    }
    wasActive.current = active
  }, [active, onPublish])

  if (!active) return null

  if (loadFailed) {
    return (
      <div className="instructor-annotation-layer instructor-annotation-layer--failed" role="alert">
        판서 편집기를 불러오지 못했습니다. 다시 시도하려면 판서를 끄고 켜 주세요.
      </div>
    )
  }

  // 청크(+365KB gzip)가 내려오는 동안. 아래 영상은 계속 보여야 하므로 자리만 잡고 비워 둔다.
  if (!ui) {
    return <div ref={hostRef} className="instructor-annotation-layer instructor-annotation-layer--loading" aria-busy="true" />
  }

  const { Excalidraw, MainMenu } = ui

  return (
    <div ref={hostRef} className="instructor-annotation-layer">
      <Excalidraw
        excalidrawAPI={handleApi}
        // Excalidraw UI를 한국어로. 강사가 쓰는 화면인데 도구 이름이 영어면 읽는 데 시간이 걸린다.
        langCode="ko-KR"
        onChange={handleChange}
        // zen 모드가 곧 "속성 패널 접기"다. 좌우 패널과 Library가 화면 밖으로 밀리고 도구 툴바만 남는다.
        zenModeEnabled={!showPropertyPanel}
        initialData={{
          /*
           * 판서를 껐다 켜면 Excalidraw가 다시 mount되어 씬이 <b>빈 상태</b>로 시작한다. 그대로 두면
           * 두 가지가 깨진다.
           *
           *   1. 강사가 그린 내용이 전부 사라진다(카메라 배치를 옮기려 잠깐 껐다 켜는 것만으로).
           *   2. 더 나쁘게, 빈 배열이 `onChange`로 들어와 diff가 이전 요소 전부를 `delete`로 내보내
           *      <b>수강생 화면과 녹화의 판서까지 지운다</b>.
           *
           * 그래서 문서의 정본을 우리가 들고(`elementsRef`) 다시 마운트할 때 되돌려준다. 화이트보드도
           * 그냥 요소라 이 경로로 함께 복원된다 — 버튼 표시와 실제 상태가 어긋나지 않는다.
           */
          elements: elementsRef.current,
          appState: {
            /*
             * 켜자마자 펜을 잡게 한다. Excalidraw는 <b>선택 도구</b>로 시작하는데, 판서를 켠 강사가
             * 곧바로 드래그하면 그림이 아니라 선택 사각형이 그려져 "켰는데 안 된다"로 읽힌다.
             * `locked: true`라야 획을 그린 뒤에도 펜이 유지된다.
             */
            activeTool: { type: 'freedraw', locked: true, lastActiveTool: null, customType: null },
            // 화면공유가 아래에 깔리므로 배경을 칠하면 안 된다.
            viewBackgroundColor: 'transparent',
            // zoom·scroll은 마운트 직후 컨테이너 크기에 맞춰 다시 잡는다(applyFrameMapping).
            // 여기 값은 첫 프레임용 초기값일 뿐이다.
            scrollX: 0,
            scrollY: 0,
            // 기본 먹색(#1e1e1e)은 어두운 슬라이드·코드 화면 위에서 거의 보이지 않는다.
            currentItemStrokeColor: DEFAULT_STROKE_COLOR,
            currentItemStrokeWidth: 2,
          },
          scrollToContent: false,
        }}
        UIOptions={{
          canvasActions: {
            // 강의 화면에 필요 없는 것들을 지운다. 특히 이미지 내보내기·저장은 판서 맥락에서
            // 오해를 부르고(수강생에게 나가는 것과 무관하다), 파일 열기는 판서를 통째로 덮어쓴다.
            export: false,
            saveAsImage: false,
            loadScene: false,
            saveToActiveFile: false,
            // 캔버스 배경은 투명이어야 한다(아래 화면공유가 비쳐야 함). 바꿀 수 있게 두면 강사가
            // 실수로 칠해 영상을 덮는다.
            changeViewBackgroundColor: false,
          },
          // 이미지 삽입은 판서에 쓰지 않는다. 넣어도 데이터 채널로 파일이 흐르지 않아 Egress에
          // 나타나지 않는다 — 강사에게만 보이는 것을 만들지 않는다.
          tools: { image: false },
        }}
      >
        {/*
          메뉴를 직접 조립한다. 기본 메뉴에는 파일 열기·내보내기·협업처럼 강의 판서와 무관하거나
          위험한 항목이 섞여 있다. 여기 넣은 것만 남는다.
        */}
        <MainMenu>
          {/* 어두운 자료 위에서는 밝은 획이, 밝은 슬라이드에서는 어두운 획이 읽힌다. */}
          <MainMenu.DefaultItems.ToggleTheme />
          {/* 판서를 한 번에 비운다. 지우개로 하나씩 지우는 것보다 빠르다. */}
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  )
}
