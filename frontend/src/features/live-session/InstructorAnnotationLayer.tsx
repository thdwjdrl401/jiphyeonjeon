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
import AnnotationActionRing, { type AnnotationAction } from './AnnotationActionRing'
import AnnotationInterpretPreview from './AnnotationInterpretPreview'
import {
  interpretAnnotation,
  latexFontSize,
  placeAtSelection,
  selectionBounds,
  type AnnotationInterpretation,
  type InterpretMode,
} from './annotationInterpret'
import { loadExcalidraw, loadMermaid, type ExcalidrawModule } from './excalidrawRuntime'

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
    selectedElementIds?: Record<string, boolean>
  }
  getSceneElements: () => readonly AnnotationElement[]
}

interface InstructorAnnotationLayerProps {
  /** 판서 해석 요청에 쓴다(§3-6e). 브라우저가 모델 게이트웨이를 직접 부르지 않는다. */
  sessionId: string
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
  sessionId,
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
  /**
   * 강사가 지금 고른 요소들. 판서 해석(§3-6e)의 <b>범위</b>다 — 모델에게 "어느 요소를 바꿀지"
   * 맞히게 하지 않고 이 선택을 그대로 넘긴다.
   *
   * <p>화이트보드는 제외한다. 배경으로 깔아 둔 판이지 정리 대상이 아니다.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  /**
   * 그린 것이 하나라도 있는지. <b>`elementsRef`로는 안 된다</b> — ref를 바꿔도 리렌더가 일어나지
   * 않아서, 강사가 처음 획을 그어도 정리 진입점이 나타나지 않는다.
   */
  const [hasElements, setHasElements] = useState(false)

  const handleChange = useCallback((
    elements: readonly AnnotationElement[],
    appState?: { selectedElementIds?: Record<string, boolean> },
  ) => {
    // 스크롤·확대가 조금이라도 밀리면 되돌린다. 판서는 영상 위에 얹히므로 캔버스가 밀리는 순간
    // 강사가 보는 자리와 합성에 나가는 자리가 갈린다 — 그런데 강사 화면에서는 정상으로 보인다.
    // 입력을 막는 것(handleWheel/키보드)이 1차 방어고, 이건 그것을 빠져나간 경우의 2차 방어다.
    applyFrameMapping()

    elementsRef.current = elements.filter((element) => element.isDeleted !== true)
    setHasElements(elementsRef.current.some((element) => element.id !== WHITEBOARD_ELEMENT_ID))
    const { changes, known } = diffAnnotationElements(knownRef.current, elements)
    knownRef.current = known
    for (const change of changes) onPublish(change)

    const picked = Object.entries(appState?.selectedElementIds ?? {})
      .filter(([id, on]) => on && id !== WHITEBOARD_ELEMENT_ID)
      .map(([id]) => id)
    // 같은 값이면 state를 건드리지 않는다 — onChange는 포인터가 움직일 때도 불린다.
    setSelectedIds((current) =>
      current.length === picked.length && current.every((id, i) => id === picked[i]) ? current : picked)
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
    // 수신 측에도 내보낸다. `knownRef`를 채웠으므로 뒤따르는 `onChange`의 diff는 아무것도 찾지 못한다 —
    // 여기서 보내지 않으면 강사 화면에만 판서가 돌아오고 수강생 화면은 빈 채로 남는다.
    onPublish({ type: 'snapshot', elements: restoredElements })
  }, [onPublish, restoredElements, ui])

  /* ── 판서 해석(ADR-0054, §3-6e) ────────────────────────────────────────────── */

  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [pending, setPending] = useState<{ result: AnnotationInterpretation; bounds: ReturnType<typeof selectionBounds> } | null>(null)
  const [applying, setApplying] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const selectedElements = useCallback(
    () => elementsRef.current.filter((element) => selectedIds.includes(element.id)),
    [selectedIds])

  /**
   * 선택한 요소만 PNG로 뽑는다. 모델이 <b>읽을</b> 용도다.
   *
   * <p>판서 문서가 벡터인데도 굳이 래스터화하는 이유는 필기 인식이 지각 문제이기 때문이다 —
   * 좌표 배열로는 손글씨를 읽어내지 못한다(ADR-0054). 좌표는 이미 우리가 갖고 있으므로 이미지에서
   * 얻을 필요가 없다.
   *
   * <p>배경을 <b>흰색으로 칠한다.</b> 투명 PNG는 검게 합성되어 검은 획이 사라진다.
   */
  const exportSelectionPng = useCallback(async (elements: readonly AnnotationElement[]) => {
    const { exportToCanvas } = await loadExcalidraw()
    const canvas = await exportToCanvas({
      elements: elements as never,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff' } as never,
      files: null,
      exportPadding: 16,
    })
    return canvas.toDataURL('image/png')
  }, [])

  const runInterpret = useCallback(async (mode: InterpretMode) => {
    const elements = selectedElements()
    const bounds = selectionBounds(elements)
    if (elements.length === 0 || !bounds) return

    setFailure(null)
    setBusyAction(mode)
    try {
      const image = await exportSelectionPng(elements)
      const result = await interpretAnnotation(sessionId, mode, image, elements.map((e) => e.id))
      // 결과를 바로 넣지 않는다. 모델이 낸 confidence는 근거가 못 된다 — 실측에서 틀린 한글
      // 라벨에 1.0이 붙었다(ADR-0054 결정 6).
      setPending({ result, bounds })
    } catch (error) {
      console.warn('판서 해석 실패', error)
      setFailure('판서를 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusyAction(null)
    }
  }, [exportSelectionPng, selectedElements, sessionId])

  /**
   * 확인한 결과를 씬에 넣는다.
   *
   * <p><b>여기가 유일한 주입 지점이다.</b> 서버는 판서를 발행하지 않는다 — 그러면 revision 채번의
   * 단일 writer 전제가 깨지고, 그 어긋남은 강사 화면에 드러나지 않는다(§3-6b). 씬을 고치면 그 뒤는
   * 기존 경로가 알아서 간다: `onChange` → diff → 데이터 채널 → 영속화.
   */
  const applyPending = useCallback(async () => {
    const api = apiRef.current
    if (!api || !pending || !pending.bounds) return
    const { result, bounds } = pending

    setApplying(true)
    try {
      const { convertToExcalidrawElements } = await loadExcalidraw()
      let created: AnnotationElement[]

      if (result.kind === 'mermaid') {
        const { parseMermaidToExcalidraw } = await loadMermaid()
        const { elements: skeleton } = await parseMermaidToExcalidraw(result.body)
        created = convertToExcalidrawElements(skeleton as never) as unknown as AnnotationElement[]
      } else {
        // 자리는 아래 placeAtSelection이 정한다. 여기서 좌표를 주면 그 값이 덮여 죽은 코드가 된다.
        created = convertToExcalidrawElements([{
          type: 'text',
          x: 0,
          y: 0,
          text: result.body,
          fontSize: latexFontSize(bounds),
          strokeColor: DEFAULT_STROKE_COLOR,
        }] as never) as unknown as AnnotationElement[]
      }

      // 배치는 우리가 정한다. mermaid는 자기 원점에서 계산했고, 모델은 위치를 말한 적이 없다.
      const placed = placeAtSelection(created, bounds)
      const removed = new Set(result.replace)
      api.updateScene({
        elements: [...api.getSceneElements().filter((element) => !removed.has(element.id)), ...placed],
      })
      setPending(null)
      setSelectedIds([])
    } catch (error) {
      console.warn('판서 정리 적용 실패', error)
      setFailure('정리한 결과를 넣지 못했습니다.')
    } finally {
      setApplying(false)
    }
  }, [pending])

  /**
   * "정리" 진입점을 눌렀는지. 눌렀으면 선택 도구로 바꾸고 무엇을 해야 하는지 알려 준다.
   *
   * <p><b>왜 필요한가.</b> 액션 링은 선택이 있어야 뜬다. 그런데 판서를 켜면 펜이 잠긴 채로
   * 시작하므로(그래야 켜자마자 그릴 수 있다) 강사는 <b>선택하는 방법을 모른 채</b> 정리 기능을
   * 찾게 된다. 실제로 "바꾸는 버튼이 어디 있냐"는 말이 나왔다. 기능이 있어도 닿을 길이 없으면
   * 없는 것과 같다.
   */
  const [ringExpanded, setRingExpanded] = useState(false)

  /** 선택 도구로 바꾼다. 펜이 잠겨 있으면 드래그도 클릭도 선택이 아니라 획이 된다. */
  const startPicking = useCallback(() => {
    apiRef.current?.updateScene({
      appState: { activeTool: { type: 'selection', locked: false, lastActiveTool: null, customType: null } },
    })
    setRingExpanded(true)
  }, [])

  /**
   * 링 바깥을 누르면 접는다.
   *
   * <p>펼쳐 놓은 메뉴가 스스로 닫히지 않으면 판서를 계속 가린다. 링 위에서 시작한 클릭은 그대로
   * 둔다 — 항목을 고르려던 것을 접어 버리면 아무것도 고를 수 없다.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!active || !host || !ringExpanded) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target?.closest('.annotation-action-ring')) return
      setRingExpanded(false)
    }
    host.addEventListener('pointerdown', onPointerDown)
    return () => { host.removeEventListener('pointerdown', onPointerDown) }
  }, [active, ringExpanded])

  /**
   * 링 중심(컨테이너 px).
   *
   * <p>선택이 있으면 <b>그 위에</b> 띄운다 — 무엇에 적용되는지가 자리로 드러난다. 선택이 없는데
   * 펼쳐진 경우(칩을 눌러 연 상태)는 칩이 있던 좌하단에 그대로 둔다. 링이 화면 밖으로 나가지
   * 않도록 가장자리에서 반지름만큼 띄운다.
   */
  const ringCenter = useCallback(() => {
    const host = hostRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    const zoom = annotationStageScale(rect)
    if (zoom <= 0) return null

    const bounds = selectionBounds(selectedElements())
    const margin = 110
    if (!bounds) {
      return { x: margin, y: Math.max(margin, rect.height - margin) }
    }
    return {
      x: Math.min(Math.max((bounds.x + bounds.width / 2) * zoom, margin), Math.max(margin, rect.width - margin)),
      y: Math.min(Math.max((bounds.y + bounds.height / 2) * zoom, margin), Math.max(margin, rect.height - margin)),
    }
  }, [selectedElements])

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
   * 판서를 켤 때, 그리고 새 참가자가 들어올 때마다 전체 스냅샷을 낸다.
   *
   * <p>두 가지를 한다. 도중에 접속한 Egress는 그 전에 흐른 op를 받을 수 없으므로 <b>판서가 빈 채로
   * 녹화되는 것</b>을 막고, 동시에 수신 측의 <b>revision 기준점</b>을 잡는다.
   *
   * <p><b>비어 있어도 보낸다.</b> Egress는 revision 0에서 시작하는데 강사는 서버에서 이어받은 번호
   * (예: 48)부터 매긴다. 기준점이 없으면 이후 op가 전부 "중간이 빠졌다"로 버려져 — 강사 화면에는
   * 그려지는데 수강생 화면에는 아무것도 나타나지 않는다. `snapshot`만 revision 검사를 건너뛰므로
   * 이것이 유일한 기준점이다. 빈 스냅샷은 수십 바이트라 아낄 이유도 없다.
   */
  useEffect(() => {
    if (!active) return
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
  /*
   * 링을 여는 두 경로. 획을 고르면(클릭이든 드래그든) 바로 뜨고, 아무것도 안 골랐어도 칩을 누르면
   * 펼쳐진다 — 후자는 "무엇을 골라야 하는지"부터 알려 주는 자리다.
   */
  const ringOpen = !pending && (selectedIds.length > 0 || ringExpanded)
  const center = ringOpen ? ringCenter() : null

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

      {/*
        선택한 판서 위에 뜨는 액션 링(ADR-0054). 강사는 지금 화면 한가운데를 보고 있으므로
        구석의 툴바로 시선을 옮기게 하지 않는다.
      */}
      {/*
        정리 기능의 진입점. 링은 선택이 있어야 뜨는데, 판서를 켜면 펜이 잠긴 채 시작해서 강사가
        선택하는 방법을 모른 채 기능을 찾게 된다 — 그래서 눈에 보이는 자리에 하나 둔다.
      */}
      {!ringOpen && !pending && hasElements && (
        <button type="button" className="annotation-interpret-entry" onClick={startPicking}>
          <span aria-hidden="true">✨</span> AI로 정리
        </button>
      )}

      {ringOpen && center && (
        <AnnotationActionRing
          center={center}
          actions={INTERPRET_ACTIONS}
          busyActionId={busyAction}
          needsSelection={selectedIds.length === 0}
          onPick={(id) => { void runInterpret(id as InterpretMode) }}
          onDismiss={() => { setSelectedIds([]); setRingExpanded(false) }}
        />
      )}

      {pending && (
        <AnnotationInterpretPreview
          result={pending.result}
          applying={applying}
          onApply={() => { void applyPending() }}
          onCancel={() => setPending(null)}
        />
      )}

      {failure && (
        <p className="annotation-interpret-failure" role="alert" onClick={() => setFailure(null)}>
          {failure}
        </p>
      )}
    </div>
  )
}

/**
 * 링에 놓는 항목. 지금은 모델을 부르는 둘뿐이다 — 도형 정리(사각형·원·직선)는 인식이 아니라
 * 기하 계산이라 별도 경로로 붙인다(ADR-0054 결정 4).
 */
const INTERPRET_ACTIONS: readonly AnnotationAction[] = [
  {
    id: 'diagram',
    label: '다이어그램',
    hint: '손그림 다이어그램을 깔끔한 도형과 화살표로 바꿉니다.',
    usesModel: true,
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="4" width="7" height="5" rx="1" />
        <rect x="15" y="4" width="7" height="5" rx="1" />
        <rect x="8.5" y="15" width="7" height="5" rx="1" />
        <path d="M9 6.5h6M5.5 9v3.5h13V9M12 12.5V15" />
      </svg>
    ),
  },
  {
    id: 'math',
    label: '수식',
    hint: '손글씨 수식을 읽어 글자로 바꿉니다.',
    usesModel: true,
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 5h6l-4 14M3 12h8M14 9l6 8M20 9l-6 8" />
      </svg>
    ),
  },
]
