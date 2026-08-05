import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import {
  WHITEBOARD_ELEMENT_ID,
  annotationStageScale,
  diffAnnotationElements,
  referencedFiles,
  laserPointFromPointer,
  orderedForScene,
  whiteboardElement,
  type AnnotationChange,
  type AnnotationElement,
  type AnnotationFiles,
  type LaserPoint,
  type LaserStroke,
} from './annotation'
import AnnotationActionRing, { type AnnotationAction } from './AnnotationActionRing'
import {
  HIGHLIGHT_CUSTOM_DATA_KEY,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_STROKE_COLOR,
  isHighlightElement,
} from './annotationHighlight'
import {
  interpretAnnotation,
  latexFontSize,
  placeAtSelection,
  selectionBounds,
  type AnnotationInterpretation,
  type InterpretMode,
} from './annotationInterpret'
import { loadExcalidraw, loadMermaid, type ExcalidrawModule } from './excalidrawRuntime'
import { mathFileEntry, renderMathSvg } from './mathRuntime'

/**
 * 판서 기본 색. 강의 화면은 대체로 밝은 슬라이드거나 어두운 코드 에디터인데, Excalidraw 기본
 * 먹색(#1e1e1e)은 후자에서 사실상 보이지 않는다. 빨강은 둘 다에서 읽힌다.
 */
const DEFAULT_STROKE_COLOR = '#e03131'

/**
 * 강조 획을 그린 뒤 캡처까지 기다리는 시간(ADR-0074). 강사가 동그라미와 밑줄을 잇달아 그어도
 * 한 건으로 묶이도록, 그리기가 <b>멎은 뒤</b>를 기준으로 한다.
 */
const HIGHLIGHT_SETTLE_MS = 1000

/**
 * 우리가 쓰는 Excalidraw 명령형 API만 좁게 선언한다. 패키지의 내부 타입 경로는 버전마다 움직이는데,
 * 여기서 그 경로에 의존하면 업그레이드가 이 파일의 컴파일을 깨뜨린다.
 */
interface ExcalidrawApi {
  updateScene: (scene: {
    elements?: readonly AnnotationElement[]
    appState?: Record<string, unknown>
    /** 이 변경을 되돌리기 스택에 올릴지. 확인 절차를 없앤 대신 Ctrl+Z가 유일한 되돌림이다. */
    captureUpdate?: string
  }) => void
  getAppState: () => {
    zoom?: { value: number }
    scrollX?: number
    scrollY?: number
    activeTool?: { type?: string }
    selectedElementIds?: Record<string, boolean>
  }
  getSceneElements: () => readonly AnnotationElement[]
  getFiles: () => AnnotationFiles
  /**
   * 파일은 <b>여기로</b> 넣는다. `updateScene`은 files를 받지 않아 실어 보내면 조용히 버려지고,
   * 이미지 요소만 남아 그림이 보이지 않는다.
   */
  addFiles: (files: readonly { id: string; mimeType: string; dataURL: string; created: number }[]) => void
  /**
   * 컨테이너의 화면상 위치를 다시 재게 한다.
   *
   * <p>Excalidraw는 컨테이너의 `left`/`top`을 <b>캐시해 두고</b> 포인터를 scene 좌표로 옮길 때 쓴다
   * (`sceneX = (clientX - offsetLeft) / zoom - scrollX`). 그 캐시는 자기 컨테이너의 <b>크기</b>가 바뀔 때만
   * 갱신되므로, 크기는 그대로인 채 자리만 움직이면 옛 값이 남아 그리는 자리와 그려지는 자리가 어긋난다.
   */
  refresh: () => void
}

interface InstructorAnnotationLayerProps {
  /** 판서 해석 요청에 쓴다(§3-6e). 브라우저가 모델 게이트웨이를 직접 부르지 않는다. */
  sessionId: string
  /**
   * 강조 획을 다 그린 뒤(1초) 부른다(ADR-0074). 인자는 그 시점의 판서 전체다.
   *
   * <p><b>여기서 캡처하지 않는다.</b> 합성에는 영상 프레임이 필요한데 그것은 이 레이어가 아니라
   * 스테이지가 갖고 있다. 이 레이어는 "언제 무엇이 강조됐는지"만 알린다.
   *
   * <p>주지 않으면 강조 툴 자체가 뜨지 않는다 — 캡처할 곳이 없는데 버튼만 있으면 안 된다.
   */
  onHighlightSettled?: (elements: readonly AnnotationElement[]) => void
  /** 판서를 켜 둔 동안만 mount한다. 껐을 때 무거운 에디터를 붙여 둘 이유가 없다. */
  active: boolean
  /** 판서 변경을 데이터 채널로 내보낸다. */
  onPublish: (change: AnnotationChange) => void
  /**
   * "여기까지의 전체 상태"를 알린다(ADR-0055). 밀린 저장을 비운 뒤 <b>포인터</b>가 나가고, 비우지
   * 못했을 때만 인자로 준 스냅샷이 나간다.
   */
  onPublishState: (snapshot: () => AnnotationChange) => void
  /**
   * 문서에 화이트보드 요소가 있는지 알린다(ADR-0056).
   *
   * <p>화이트보드 버튼은 <b>이 값에서 파생</b>한다. 예전에는 버튼이 자기 상태를 따로 들고 있어서,
   * 새로고침하면 화면에는 판이 있는데 버튼은 "꺼짐"이 됐다 — 문서가 정본인데 버튼이 그것을 읽지
   * 않았기 때문이다.
   */
  onWhiteboardPresence: (present: boolean) => void
  /**
   * 복원 체크포인트를 남긴다(ADR-0057). 문서-변경 op가 일정 수 쌓일 때마다 부른다.
   *
   * <p>스냅샷을 <b>값이 아니라 함수로</b> 넘긴다 — 실제로 저장할 때만 문서를 만들면 된다.
   */
  onSaveSnapshot: (snapshot: () => AnnotationChange) => void
  /** 새 참가자가 들어올 때마다 오르는 값. 오르면 전체 상태를 다시 알린다. */
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
  /**
   * 저장돼 있던 파일들(수식 SVG 등). 요소만 되살리면 이미지가 가리킬 것이 없어 <b>빈 자리</b>가
   * 된다 — 새로고침하면 수식이 사라진 것처럼 보인다.
   */
  restoredFiles: AnnotationFiles | null
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
/**
 * 체크포인트 사이의 문서-변경 op 수(ADR-0057).
 *
 * <p>실측에서 op 하나가 평균 4.2kB였다(983kB / 233건). 100건이면 복원이 "체크포인트 + 최대 100건"으로
 * 묶인다. 정확한 상한은 판서 크기에 따라 달라지므로 실측으로 조정할 값이다.
 */
const OPS_PER_SNAPSHOT = 100

/**
 * 판서 해석에 보낼 이미지의 긴 변 상한(px).
 *
 * <p><b>더는 바이트에 맞추지 않는다</b>(ADR-0058). 이미지는 요청 본문이 아니라 URL로 전달되므로
 * 게이트웨이 본문 한도(~100KB)와 무관해졌다. 예전에는 예산에 맞추려 화질을 깎았고, 크게 그릴수록
 * 모델이 판서를 못 읽었다.
 *
 * <p>그래도 상한은 둔다. Excalidraw 기본은 `scale: 2`라 선택 범위가 넓으면 캔버스가 무한정 커지고,
 * 그것을 만들고 옮기는 비용은 그대로 강사가 기다리는 시간이 된다. 모델이 손글씨·도형을 알아보는
 * 데 필요한 해상도만 있으면 된다.
 */
const INTERPRET_IMAGE_MAX_EDGE = 2000

export default function InstructorAnnotationLayer({
  sessionId,
  active,
  onHighlightSettled,
  onPublish,
  onPublishState,
  onWhiteboardPresence,
  onSaveSnapshot,
  audienceRevision,
  showPropertyPanel,
  whiteboard,
  onLaser,
  restoredElements,
  restoredFiles,
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

  /**
   * 마지막 체크포인트 이후 내보낸 <b>문서-변경</b> op 수(ADR-0057).
   *
   * <p>포인터·`clear`처럼 문서를 바꾸지 않는 op는 세지 않는다 — 그것들은 복원 크기를 늘리지 않는다.
   */
  const sinceSnapshotRef = useRef(0)

  /**
   * 마지막으로 부모에게 알린 화이트보드 존재 여부. 같은 값을 다시 알리지 않기 위한 것이다 —
   * `onChange`마다 부모 setState를 부르면 렌더 루프가 된다(위 `handleChange` 참조).
   */
  const reportedBoardRef = useRef<boolean | null>(null)

  /** 지금까지 내보낸 요소의 `id → version`. 바뀐 것만 골라내는 기준이다. */
  const knownRef = useRef(new Map<string, number>())
  /** 마지막으로 본 전체 요소. 스냅샷을 다시 낼 때 쓴다. */
  const elementsRef = useRef<AnnotationElement[]>([])
  /**
   * 마지막으로 본 파일들. 스냅샷에도 실어야 한다 — 도중에 합류한 Egress는 그 전에 흐른 upsert를
   * 받지 못하므로, 스냅샷에 파일이 없으면 수식이 빈 자리로 녹화된다.
   */
  const filesRef = useRef<AnnotationFiles>({})

  /**
   * 논리 프레임(1920x1080)을 컨테이너에 매핑하는 zoom을 유지한다.
   *
   * <p>컨테이너 크기가 바뀔 때마다 다시 잰다 — 창 크기 변경과 전체화면 전환이 모두 이 경로로
   * 처리된다. `scroll`도 0으로 되돌린다: 강사가 실수로 캔버스를 밀면 보는 자리와 나가는 자리가
   * 달라지는데, 강사 화면에서는 그게 드러나지 않는다.
   */
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ExcalidrawApi | null>(null)

  /**
   * 마지막으로 잰 zoom.
   *
   * <p><b>왜 캐시하는가.</b> {@link applyFrameMapping}은 `onChange`마다 불리는데(획을 긋는 동안
   * 초당 수십 번) `getBoundingClientRect`는 그때마다 <b>동기 레이아웃을 강제한다</b>. 크기는 컨테이너가
   * 바뀔 때만 달라지고 그건 아래 `ResizeObserver`가 이미 잡고 있으므로, 그리는 경로에서 다시 잴
   * 이유가 없다.
   *
   * <p>드리프트 방어는 그대로다 — 값을 비교해 되돌리는 일은 여전히 매번 한다. 캐시한 것은 <b>측정</b>
   * 하나뿐이다.
   */
  const frameZoomRef = useRef(0)
  /** 마지막으로 Excalidraw에 반영한 캔버스의 화면상 좌상단. 크기 변화 없는 <b>이동</b>을 잡는 기준이다. */
  const hostOriginRef = useRef<{ left: number; top: number } | null>(null)

  const measureFrame = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    /*
     * <b>움직이기만 해도 다시 재게 한다.</b> Excalidraw는 컨테이너의 left/top을 캐시해 포인터를 scene
     * 좌표로 옮기는데, 그 캐시를 자기 ResizeObserver로만 갱신한다 — 즉 <b>크기가 바뀔 때만</b> 갱신된다.
     *
     * 이 캔버스는 크기가 그대로인 채 움직인다. 16:9 프레임(.instructor-media-canvas)이 미리보기 영역
     * 가운데 놓이는데(place-items: center), 영역이 16:9보다 가로로 길면 프레임 크기는 높이에 묶여
     * 고정되고 남는 폭만큼 좌우로 재배치된다. 사이드 패널을 접어 강의 화면이 넓어지는 순간이 정확히
     * 그 경우다 — 프레임은 같은 크기로 오른쪽으로 밀리고, 크기가 안 바뀌었으니 Excalidraw는 옛 left를
     * 그대로 들고 있다. 그 차이만큼 그리는 자리와 그려지는 자리가 어긋난다(zoom은 멀쩡하다).
     *
     * <p>측정은 이 함수(ResizeObserver 경로)에서만 한다 — `applyFrameMapping`은 이제 `getBoundingClientRect`를
     * 부르지 않으므로(위 성능 최적화), 위치 추적도 여기서 해야 사이드 패널 접힘을 놓치지 않는다.
     */
    const origin = hostOriginRef.current
    if (!origin || origin.left !== rect.left || origin.top !== rect.top) {
      hostOriginRef.current = { left: rect.left, top: rect.top }
      apiRef.current?.refresh()
    }
    frameZoomRef.current = annotationStageScale({ width: rect.width, height: rect.height })
  }, [])

  const applyFrameMapping = useCallback(() => {
    const api = apiRef.current
    const zoom = frameZoomRef.current
    if (!api || zoom <= 0) return
    const state = api.getAppState()
    if (state.zoom?.value === zoom && state.scrollX === 0 && state.scrollY === 0) return
    api.updateScene({ appState: { zoom: { value: zoom }, scrollX: 0, scrollY: 0 } })
  }, [])

  /**
   * 에디터 API가 도착했는가. <b>ref가 아니라 state여야 한다.</b>
   *
   * <p>Excalidraw는 이 콜백을 <b>렌더 중에</b> 부른다 — 아직 mount 전이라 그 자리에서
   * {@code updateScene}을 부르면 React가 조용히 무시한다("Can't call setState on a component
   * that is not yet mounted"). 게다가 ref에만 담으면 <b>API가 준비된 것이 effect를 다시 돌게
   * 하지 못한다</b> — 복원 시딩이 다른 값(`ui`)이 바뀌는 것에 얹혀 우연히 도는 구조가 된다.
   *
   * <p>state로 두면 API 도착이 그 자체로 렌더를 만들고, 뒤따르는 effect는 mount가 끝난 뒤에 돈다.
   */
  const [apiReady, setApiReady] = useState(false)

  const handleApi = useCallback((api: ExcalidrawApi) => {
    apiRef.current = api
    /*
     * Excalidraw는 이 콜백을 <b>자기 렌더 중에</b> 부른다. 그 자리에서 setState하면 React가
     * "Cannot update a component while rendering a different component"으로 거부한다.
     * 마이크로태스크로 미뤄 렌더가 끝난 뒤에 알린다.
     */
    queueMicrotask(() => setApiReady(true))
  }, [])

  // mount가 끝난 뒤에 프레임 매핑을 건다. handleApi 안에서 부르면 무시된다(위 참조).
  useEffect(() => {
    if (!apiReady) return
    measureFrame()
    applyFrameMapping()
  }, [apiReady, applyFrameMapping, measureFrame])

  useEffect(() => {
    const host = hostRef.current
    if (!active || !host) return undefined
    // 크기를 다시 재는 자리는 여기뿐이다. 그리는 경로(onChange)는 잰 값을 쓰기만 한다.
    const remeasure = () => { measureFrame(); applyFrameMapping() }
    remeasure()
    const observer = new ResizeObserver(remeasure)
    observer.observe(host)
    /*
     * 캔버스를 담고 있는 미리보기 영역도 함께 본다. <b>호스트만 보면 놓치는 경우가 있다</b> —
     * 사이드 패널을 접으면 이 영역만 넓어지고, 높이에 묶인 16:9 캔버스는 크기 그대로 가운데로 다시
     * 놓인다. 크기가 안 바뀌니 호스트의 ResizeObserver는 울리지 않고(Excalidraw 내부 것도 마찬가지다),
     * 그 사이 캔버스는 옆으로 밀려 있다. 넓어지는 쪽을 봐야 그 이동을 제때 알 수 있다.
     */
    const frame = host.closest('.instructor-media-preview')
    if (frame && frame !== host) observer.observe(frame)
    return () => { observer.disconnect() }
  }, [active, applyFrameMapping, measureFrame])


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

  /**
   * 강조 툴이 켜져 있는지(ADR-0074). Excalidraw의 활성 툴을 그대로 읽지 않고 우리가 들고 있는다 —
   * 강사가 지우개나 선택으로 잠시 바꿔도 "강조 모드였다"는 의도는 유지돼야 하기 때문이다.
   */
  const [highlightMode, setHighlightMode] = useState(false)

  /** 콜백 안에서 읽기 위한 사본. state로 읽으면 handleChange가 모드마다 다시 만들어진다. */
  const highlightModeRef = useRef(false)

  /**
   * 표식을 붙이지 않을 요소 id. <b>무한 루프를 막는 유일한 장치다.</b>
   *
   * <p>표식을 붙이려면 {@code updateScene}을 불러야 하고, 그러면 Excalidraw가 다시 {@code onChange}를
   * 부른다. 그때 같은 요소를 또 건드리면 그 자리에서 앱이 죽는다 — 이 파일에 이미 같은 사고가
   * 기록돼 있다("Maximum update depth exceeded"). 그래서 <b>updateScene을 부르기 전에</b> 여기 넣는다.
   *
   * <p><b>강조 모드를 켤 때 그 시점의 요소를 전부 넣는다</b>(ADR-0079). 예전에는 "표식 없는 요소"를
   * 곧 "강조 모드에서 새로 그린 것"으로 봤는데, 그러면 모드를 켜기 <b>전에</b> 그린 일반 판서와
   * 복원된 판서까지 통째로 강조로 둔갑했다. 강조가 아닌 획이 근거로 색인되고, 지우개 의미도 갈린다.
   */
  const taggedRef = useRef<Set<string>>(new Set())

  /**
   * 콜백을 ref로도 들고 있는다. 디바운스 타이머가 도는 동안 부모가 새 함수를 넘겨도 옛 참조를
   * 부르지 않기 위해서다 — 그리고 이 값이 바뀔 때마다 감지 함수를 다시 만들지 않아도 된다.
   */
  const onHighlightSettledRef = useRef(onHighlightSettled)
  onHighlightSettledRef.current = onHighlightSettled

  const highlightTimerRef = useRef<number | null>(null)

  /**
   * 강조 획이 늘었으면 <b>그리기가 멎은 뒤</b> 한 번만 알린다(ADR-0074).
   *
   * <p><b>왜 디바운스인가.</b> `onChange`는 포인터가 움직일 때마다 불린다. 획 하나를 긋는 동안
   * 수십 번 불리는데, 매번 캡처하면 같은 강조로 이미지가 수십 장 쌓이고 비전 모델도 그만큼 불린다.
   * 강사가 여러 획으로 하나를 표시하는 경우(동그라미 + 밑줄)도 한 건으로 묶여야 한다.
   *
   * <p>지운 것은 세지 않는다 — 지우개로 강조를 지우는 것은 취소이지 새 캡처가 아니다.
   */
  /**
   * 강조 획을 다 그린 뒤(1초) 표식을 붙이고 알린다(ADR-0074).
   *
   * <p><b>그리는 도중에 붙이면 안 된다.</b> 표식은 {@code updateScene}으로 씬을 갈아끼워야 하는데,
   * freedraw는 점이 늘 때마다 {@code onChange}를 부른다. 첫 점에서 씬을 덮으면 진행 중인 획이 그
   * 시점으로 되돌아가 <b>찍은 점 하나만 남는다</b> — 그리고 그 망가진 문서가 그대로 op로 나가
   * 수강생도 똑같이 점 하나만 본다. 실제로 그렇게 배포됐다.
   *
   * <p>그래서 "그리기가 멎었는가"를 먼저 판단하고, 그 뒤에 표식과 알림을 <b>한 번에</b> 처리한다.
   * 붙인 결과를 로컬에서 만들어 그대로 넘기므로 재진입한 onChange를 기다리지 않는다.
   */
  const detectHighlightSettled = useCallback((elements: readonly AnnotationElement[]) => {
    if (!highlightModeRef.current && !elements.some(isHighlightElement)) return
    const notify = onHighlightSettledRef.current
    if (!notify) return

    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null
      const latest = elementsRef.current
      const api = apiRef.current

      // 강조 모드에서 새로 그린 것 = 아직 표식이 없는 요소. 그리기가 멎은 지금이 붙일 때다.
      const targets = highlightModeRef.current && api
        ? latest.filter((element) => element.id !== WHITEBOARD_ELEMENT_ID
          && !taggedRef.current.has(element.id)
          && !isHighlightElement(element))
        : []

      if (targets.length > 0 && api) {
        const ids = new Set(targets.map((element) => element.id))
        for (const id of ids) taggedRef.current.add(id)
        const tagged = latest.map((element) => ids.has(element.id)
          ? {
            ...element,
            customData: { ...(element.customData as object ?? {}), [HIGHLIGHT_CUSTOM_DATA_KEY]: true },
          }
          : element)
        /*
         * 되돌리기 스택에 올리지 않는다(captureUpdate 미지정 = 기본). 표식은 강사가 한 편집이 아니라
         * 우리가 붙인 꼬리표라, 여기에 되돌리기 지점이 생기면 Ctrl+Z 한 번이 획을 지우는 대신
         * 표식만 떼어낸다 — 강사에게는 아무 일도 안 일어난 것처럼 보인다.
         */
        api.updateScene({ elements: tagged })
        elementsRef.current = tagged
        notify(tagged)
      }

      /*
       * 새로 붙인 것이 없으면 <b>묻지 않는다.</b> 예전에는 "표식이 있으면 알린다"로 두었는데, 강조는
       * 한 번 그리면 문서에 계속 남으므로 그 뒤 모든 정지마다 확인 창이 다시 떴다. 이미 물어본 강조를
       * 무한히 다시 묻는 셈이었다 — 복원된 강조도 그렸던 세션에서 이미 처리됐다.
       */
    }, HIGHLIGHT_SETTLE_MS)
  }, [])

  const toggleHighlightTool = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    const next = !highlightMode
    setHighlightMode(next)
    highlightModeRef.current = next
    /*
     * 켜는 순간의 요소를 전부 제외 목록에 넣는다(ADR-0079). 그래야 "표식 없는 요소"가 "지금부터
     * 그린 것"과 같아진다 — 이 시딩이 없으면 모드를 켜기 전의 일반 판서가 첫 캡처에서 통째로
     * 강조가 된다. 끌 때는 건드리지 않는다. 이미 붙은 표식은 그대로 남아야 한다.
     */
    if (next) for (const element of elementsRef.current) taggedRef.current.add(element.id)
    api.updateScene({
      appState: next
        ? {
          activeTool: { type: 'freedraw', locked: true, lastActiveTool: null, customType: null },
          currentItemStrokeColor: HIGHLIGHT_STROKE_COLOR,
          currentItemOpacity: HIGHLIGHT_OPACITY,
        }
        : {
          activeTool: { type: 'freedraw', locked: true, lastActiveTool: null, customType: null },
          currentItemStrokeColor: DEFAULT_STROKE_COLOR,
          currentItemOpacity: 100,
        },
    })
  }, [highlightMode])

  /**
   * 판서를 한 번에 비운다.
   *
   * <p><b>Excalidraw 기본 `ClearCanvas`를 쓰지 않는 이유가 여기 있다.</b> 그 액션은 요소만 지우는 게
   * 아니라 appState를 통째로 `getDefaultAppState()`로 되돌린다(보존하는 것은 theme·penMode·activeTool
   * 등 소수뿐이다). 되돌아가는 값에 `viewBackgroundColor`가 섞여 있어서, 누르는 순간 캔버스가
   * 기본 흰색(#ffffff)으로 칠해지고 <b>아래에 깔린 카메라·화면공유를 덮는다</b>. 판서를 지우려다
   * 영상을 잃는 셈이고, 같은 문서를 렌더하는 Egress도 같은 흰 판을 녹화한다.
   *
   * <p>그래서 요소만 비우고 appState는 건드리지 않는다. 배경만 한 번 더 못박는다 — "이 레이어는
   * 투명해야 한다"는 선언이 지금은 마운트 시 `initialData`에만 있어서, 지우기 경로가 그 유일한
   * 선언에서 멀어지면 같은 사고가 조용히 돌아온다.
   *
   * <p>획 색·도구는 그대로 둔다. 강조 모드(ADR-0074)처럼 지우기와 무관한 상태를 여기서 되돌리면
   * 모드는 켜져 있는데 색만 기본으로 돌아가 둘이 갈린다.
   *
   * <p>수강생·녹화까지 비워지는 것은 기존 경로가 맡는다: 빈 씬 → `onChange` → diff가 `delete` op를
   * 만든다. 여기서 직접 publish하지 않는다 — 두 경로가 생기면 revision이 어긋난다(§3-6b).
   */
  const clearAnnotations = useCallback(async () => {
    const api = apiRef.current
    if (!api) return
    const { CaptureUpdateAction } = await loadExcalidraw()
    // 지운 요소의 강조 표식도 잊는다. 남겨 두면 같은 id가 다시 쓰일 때 "이미 물어본 강조"로 잡혀
    // 새로 그린 강조가 캡처되지 않는다.
    taggedRef.current.clear()
    api.updateScene({
      elements: [],
      appState: { viewBackgroundColor: 'transparent' },
      // 되돌리기 스택에 올린다. 확인 창을 띄우지 않으므로 Ctrl+Z가 유일한 되돌림이다.
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
  }, [])

  const handleChange = useCallback((
    elements: readonly AnnotationElement[],
    appState?: { selectedElementIds?: Record<string, boolean> },
    files?: AnnotationFiles,
  ) => {
    // 스크롤·확대가 조금이라도 밀리면 되돌린다. 판서는 영상 위에 얹히므로 캔버스가 밀리는 순간
    // 강사가 보는 자리와 합성에 나가는 자리가 갈린다 — 그런데 강사 화면에서는 정상으로 보인다.
    // 입력을 막는 것(handleWheel/키보드)이 1차 방어고, 이건 그것을 빠져나간 경우의 2차 방어다.
    applyFrameMapping()

    elementsRef.current = elements.filter((element) => element.isDeleted !== true)
    if (files) filesRef.current = files
    setHasElements(elementsRef.current.some((element) => element.id !== WHITEBOARD_ELEMENT_ID))
    detectHighlightSettled(elementsRef.current)

    /*
     * 문서에 판이 있는지 알린다. 버튼은 이 값을 따른다(ADR-0056).
     *
     * <p><b>바뀔 때만 부른다.</b> `onChange`는 포인터가 움직일 때도 불리는데, 여기서 매번 부모의
     * setState를 부르면 <b>부모 렌더 → Excalidraw 갱신 → componentDidUpdate → onChange</b>가 돌면서
     * "Maximum update depth exceeded"로 앱이 통째로 죽는다(React #185). 실제로 화이트보드를 켜는
     * 순간 화면이 하얗게 되며 그렇게 터졌다.
     *
     * <p>같은 이유로 이 파일의 다른 보고(`setHasElements`·`setSelectedIds`)도 값이 같으면 건드리지
     * 않는다. 부모로 올라가는 호출은 전부 이 규칙을 지켜야 한다.
     */
    const boardPresent = elementsRef.current.some((element) => element.id === WHITEBOARD_ELEMENT_ID)
    if (reportedBoardRef.current !== boardPresent) {
      reportedBoardRef.current = boardPresent
      onWhiteboardPresence(boardPresent)
    }
    const { changes, known } = diffAnnotationElements(knownRef.current, elements)
    knownRef.current = known
    for (const change of changes) {
      // 이미지 요소는 데이터를 담지 않고 `fileId`로 가리키기만 한다. 파일을 함께 싣지 않으면
      // 수식이 수강생 화면에서 빈 자리가 된다(§3-6b).
      //
      // 다만 <b>이번에 실린 요소가 가리키는 것만</b> 보낸다. 전부 실으면 획 하나를 그을 때마다
      // 판서에 있는 모든 수식 SVG가 데이터 채널과 DB로 다시 나간다.
      onPublish(change.type === 'upsert'
        ? { ...change, files: referencedFiles(change.elements, filesRef.current) }
        : change)
      sinceSnapshotRef.current += 1
    }

    /*
     * <b>주기적으로 복원 체크포인트를 남긴다</b>(ADR-0057).
     *
     * <p>없으면 복원이 세션 시작부터 전부 내려온다 — 실측에서 op 233건이 983kB였고, 강의가 길어질수록
     * 무한히 자란다. 여기서 문서 전체를 한 번 저장해 두면 복원이 "체크포인트 + 그 이후 몇 건"으로 묶인다.
     *
     * <p>데이터 채널로는 나가지 않는다. 저장 경로로만 보낸다.
     */
    if (sinceSnapshotRef.current >= OPS_PER_SNAPSHOT) {
      sinceSnapshotRef.current = 0
      onSaveSnapshot(() => ({
        type: 'snapshot',
        elements: elementsRef.current,
        files: referencedFiles(elementsRef.current, filesRef.current),
      }))
    }

    const picked = Object.entries(appState?.selectedElementIds ?? {})
      .filter(([id, on]) => on && id !== WHITEBOARD_ELEMENT_ID)
      .map(([id]) => id)
    // 같은 값이면 state를 건드리지 않는다 — onChange는 포인터가 움직일 때도 불린다.
    setSelectedIds((current) =>
      current.length === picked.length && current.every((id, i) => id === picked[i]) ? current : picked)
  }, [applyFrameMapping, detectHighlightSettled, onPublish, onSaveSnapshot, onWhiteboardPresence])

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
    if (seededRef.current) return
    if (!restoredElements || restoredElements.length === 0) return
    /*
     * <b>건너뛸 때는 이유를 남긴다.</b> 이 자리가 조용히 지나가면 증상이 "강사 화면에서만 판서가
     * 사라진다"로 나타나고, 서버·전송·복원이 전부 정상이라 밖에서는 어디서 막혔는지 알 수 없다.
     * 실제로 그 상태로 한참을 헤맸다.
     *
     * <p><b>다만 수준을 구분한다.</b> 아래 둘은 <b>정상 경로</b>다 — 에디터가 지연 청크라 늦게
     * 오는 것도, 강사가 복원보다 먼저 그리는 것도 이상한 일이 아니다. 그것을 `warn`으로 찍으면
     * 콘솔에 노란 경고와 스택 트레이스가 남아 <b>고장처럼 보인다</b>. 실제로 "이 로그는 왜 뜨냐"는
     * 질문을 받았다. 진짜 이상은 아래 `updateScene`이 먹히지 않았을 때뿐이고, 그것만 `warn`이다.
     */
    if (!api) {
      console.debug('판서 복원 대기 — 편집기 청크를 불러오는 중이다. 도착하면 넣는다.')
      return
    }
    if (elementsRef.current.length > 0) {
      console.debug(
        `판서 복원 생략 — 강사가 복원보다 먼저 그렸다(씬에 ${elementsRef.current.length}개). `
        + '방금 그린 획을 복원본으로 덮지 않는다.')
      return
    }
    seededRef.current = true
    elementsRef.current = [...restoredElements]
    /*
     * 복원본은 표식 대상이 아니다(ADR-0079). 이전 세션에서 이미 처리된 획이라 지금 강조로 만들면
     * 그리지도 않은 것이 근거로 색인된다. 강조 모드가 켜진 채 복원이 늦게 도착하는 경우가 실제로 있다.
     */
    for (const element of restoredElements) taggedRef.current.add(element.id)
    // 파일을 <b>먼저</b> 넣는다. 요소가 먼저 들어가면 그 사이 렌더에서 가리킬 파일이 없다.
    if (restoredFiles) {
      const list = Object.values(restoredFiles)
      if (list.length > 0) api.addFiles(list)
      filesRef.current = { ...filesRef.current, ...restoredFiles }
    }
    const known = new Map<string, number>()
    for (const element of restoredElements) known.set(element.id, element.version ?? 0)
    knownRef.current = known
    /*
     * <b>Egress와 같은 순서로 넣는다</b>(ADR-0056). Excalidraw는 배열 순서를 z-order로 쓰는데,
     * 서버에서 온 순서는 그리기 순서라 화이트보드가 맨 앞이라는 보장이 없다. 그대로 넣으면 판이
     * 판서를 덮고, 강사는 화이트보드를 껐다 켜야 판서를 다시 본다.
     *
     * <p>수신 측(Egress)에는 이 보정이 원래 있었다. 강사 에디터에만 없어서 <b>같은 문서가 두
     * 화면에서 다르게 그려지고</b> 있었다.
     */
    const ordered = orderedForScene(restoredElements)
    api.updateScene({ elements: ordered })
    /*
     * <b>들어갔는지 확인한다.</b> `updateScene`은 실패해도 던지지 않는다 — 에디터가 아직 mount되지
     * 않았으면 그냥 무시된다(React가 "Can't call setState on a component that is not yet mounted"만
     * 남긴다). 그러면 강사 화면만 빈 채로 남고 아무도 모른다.
     *
     * 다음 tick에 다시 확인해, 비어 있으면 한 번 더 넣는다. 그때는 mount가 끝나 있다.
     */
    setTimeout(() => {
      const current = apiRef.current
      if (!current) return
      const inScene = current.getSceneElements()
      if (inScene.length > 0) return
      // 여기는 진짜 이상이다 — `updateScene`이 무시됐다는 뜻이라 경고로 남긴다.
      console.warn('판서 복원이 씬에 반영되지 않았다 — 다시 넣는다')
      current.updateScene({ elements: orderedForScene(restoredElements) })
    }, 0)
    // 수신 측에도 알린다. `knownRef`를 채웠으므로 뒤따르는 `onChange`의 diff는 아무것도 찾지 못한다 —
    // 여기서 알리지 않으면 강사 화면에만 판서가 돌아오고 수강생 화면은 빈 채로 남는다.
    //
    // 문서를 실어 보내지 않는다(ADR-0055). 방금 복원한 이 문서는 <b>서버에서 온 것</b>이라 이미
    // 서버에 있고, 그대로 다시 밀면 판서가 길어졌을 때 데이터 채널의 64KB 한도를 넘는다.
    onPublishState(() => ({
      type: 'snapshot',
      elements: restoredElements,
      files: referencedFiles(restoredElements, filesRef.current),
    }))
  }, [apiReady, onPublishState, restoredElements, restoredFiles, ui])

  /* ── 판서 해석(ADR-0054, §3-6e) ────────────────────────────────────────────── */

  const [busyAction, setBusyAction] = useState<string | null>(null)
  /** 지금 고치고 있는 수식의 LaTeX. null이면 편집 중이 아니다. */
  const [editingMath, setEditingMath] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  /** 방금 무엇을 넣었는지. 되돌리는 방법과 함께 잠깐 보여 준다. */
  const [applied, setApplied] = useState<string | null>(null)
  useEffect(() => {
    if (!applied) return undefined
    // 확인 절차를 없앤 만큼 무슨 일이 일어났는지는 알려야 한다. 다만 계속 떠 있으면 판서를 가린다.
    const timer = setTimeout(() => setApplied(null), 4000)
    return () => { clearTimeout(timer) }
  }, [applied])

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
      // 긴 변만 제한한다. 바이트는 더 이상 문제가 아니다 — 이미지는 URL로 전달된다(ADR-0058).
      getDimensions: (width: number, height: number) => {
        const longest = Math.max(width, height)
        return { width, height, scale: longest > INTERPRET_IMAGE_MAX_EDGE ? INTERPRET_IMAGE_MAX_EDGE / longest : 1 }
      },
    })
    return canvas.toDataURL('image/png')
  }, [])

  /**
   * 해석 결과를 씬에 넣는다.
   *
   * <p><b>여기가 유일한 주입 지점이다.</b> 서버는 판서를 발행하지 않는다 — 그러면 revision 채번의
   * 단일 writer 전제가 깨지고, 그 어긋남은 강사 화면에 드러나지 않는다(§3-6b). 씬을 고치면 그 뒤는
   * 기존 경로가 알아서 간다: `onChange` → diff → 데이터 채널 → 영속화.
   *
   * <p><b>확인을 받지 않는다.</b> 매 정리마다 확인 창을 띄우면 강의 흐름이 끊기고, 잘못 나온 것을
   * 되돌리는 비용은 그보다 훨씬 싸다 — 강사는 이미 되돌리기를 쓰고 있다. 대신 이 변경이 되돌리기
   * 스택에 반드시 올라가야 한다(`captureUpdate`).
   */
  /**
   * 선택한 것이 우리가 넣은 수식 하나인지. 그렇다면 <b>다시 쓸 수 있다</b>.
   *
   * <p>수식을 그림으로 넣는 순간 내용을 고칠 수 없게 된다 — ADR-0051이 Excalidraw를 고른 이유가
   * "결과가 다시 고칠 수 있는 객체여야 한다"였으므로 그대로 두면 그 전제를 깬다. 그래서 넣을 때
   * LaTeX 원문을 요소에 붙여 두고(`customData`), 여기서 그것을 꺼내 다시 렌더한다.
   */
  const selectedMathLatex = useCallback((): string | null => {
    const picked = selectedElements()
    if (picked.length !== 1) return null
    const custom = picked[0].customData as { liveclassMathLatex?: string } | undefined
    return custom?.liveclassMathLatex ?? null
  }, [selectedElements])

  /**
   * 고친 LaTeX로 수식 그림을 갈아 끼운다.
   *
   * <p>자리와 크기는 <b>지금 그 요소가 놓인 자리</b>를 그대로 쓴다. 강사가 옮겨 두었을 수 있는데
   * 고쳤다고 원래 자리로 되돌아가면 놀란다.
   */
  const reeditMath = useCallback(async (latex: string) => {
    const api = apiRef.current
    const picked = selectedElements()
    if (!api || picked.length !== 1) return
    const target = picked[0]
    const bounds = selectionBounds([target])
    if (!bounds) return

    setBusyAction('math')
    try {
      const { convertToExcalidrawElements, CaptureUpdateAction } = await loadExcalidraw()
      const fileId = `math-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const rendered = await renderMathSvg(latex, latexFontSize(bounds))
      const created = convertToExcalidrawElements([{
        type: 'image',
        x: 0,
        y: 0,
        width: rendered.width,
        height: rendered.height,
        fileId,
        customData: { liveclassMathLatex: latex },
      }] as never) as unknown as AnnotationElement[]

      const placed = placeAtSelection(created, bounds)
      api.addFiles(Object.values(mathFileEntry(fileId, rendered, Date.now())))
      api.updateScene({
        elements: [...api.getSceneElements().filter((element) => element.id !== target.id), ...placed],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      setEditingMath(null)
      setSelectedIds([])
      setRingExpanded(false)
      setApplied('수식을 고쳤습니다')
    } catch (error) {
      console.warn('수식 재편집 실패', error)
      setFailure('수식을 고치지 못했습니다.')
    } finally {
      setBusyAction(null)
    }
  }, [selectedElements])

  const applyResult = useCallback(async (
    result: AnnotationInterpretation,
    bounds: NonNullable<ReturnType<typeof selectionBounds>>,
  ) => {
    const api = apiRef.current
    if (!api) return

    try {
      const { convertToExcalidrawElements, CaptureUpdateAction } = await loadExcalidraw()
      let created: AnnotationElement[]
      let mathFiles: AnnotationFiles = {}
      const fileId = `math-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

      if (result.kind === 'mermaid') {
        const { parseMermaidToExcalidraw } = await loadMermaid()
        const { elements: skeleton } = await parseMermaidToExcalidraw(result.body)
        created = convertToExcalidrawElements(skeleton as never) as unknown as AnnotationElement[]
      } else {
        // 수식은 <b>그림</b>으로 넣는다. 분수의 가로줄이나 적분 기호의 상하 구조는 글자로 표현할 수
        // 없다. 다만 그림이 되면 내용을 고칠 수 없으므로, LaTeX 원문을 요소에 붙여 두어 나중에
        // 다시 렌더할 수 있게 한다(ADR-0051의 "고칠 수 있어야 한다"를 지키는 방법이다).
        const latex = result.source || result.body
        const rendered = await renderMathSvg(latex, latexFontSize(bounds))
        mathFiles = mathFileEntry(fileId, rendered, Date.now())
        // 자리는 아래 placeAtSelection이 정한다. 여기서 좌표를 주면 그 값이 덮여 죽은 코드가 된다.
        created = convertToExcalidrawElements([{
          type: 'image',
          x: 0,
          y: 0,
          width: rendered.width,
          height: rendered.height,
          fileId,
          customData: { liveclassMathLatex: latex },
        }] as never) as unknown as AnnotationElement[]
      }

      // 배치는 우리가 정한다. mermaid는 자기 원점에서 계산했고, 모델은 위치를 말한 적이 없다.
      const placed = placeAtSelection(created, bounds)
      const removed = new Set(result.replace)
      // 파일을 <b>먼저</b> 넣는다. 요소가 먼저 들어가면 그 사이 렌더에서 가리킬 파일이 없어
      // 빈 자리가 보인다. `updateScene`은 files를 받지 않으므로 이 경로가 유일하다.
      const fileList = Object.values(mathFiles)
      if (fileList.length > 0) api.addFiles(fileList)
      api.updateScene({
        elements: [...api.getSceneElements().filter((element) => !removed.has(element.id)), ...placed],
        // 되돌리기 스택에 올린다. 확인 절차를 없앤 대신 Ctrl+Z가 유일한 되돌림이라, 이게 빠지면
        // 잘못 나온 정리를 강사가 손으로 지워야 한다.
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      setSelectedIds([])
      setRingExpanded(false)
      setApplied(result.kind === 'mermaid' ? '다이어그램으로 정리했습니다' : '수식으로 정리했습니다')
    } catch (error) {
      console.warn('판서 정리 적용 실패', error)
      setFailure('정리한 결과를 넣지 못했습니다.')
    }
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
      if (result.unreadable || !result.body) {
        setFailure('판서를 알아보지 못했습니다. 더 또렷하게 그린 뒤 다시 시도해 주세요.')
        return
      }
      // 확인을 거치지 않고 바로 넣는다. 되돌림은 Ctrl+Z가 맡는다 — 매번 확인 창을 띄우면
      // 강의 흐름이 끊기고, 잘못 나온 것을 되돌리는 비용은 그보다 훨씬 싸다.
      await applyResult(result, bounds)
    } catch (error) {
      console.warn('판서 해석 실패', error)
      /*
       * "잠시 후 다시"는 이 실패에 맞지 않는다. 가장 흔한 원인은 <b>선택 범위가 넓어 이미지가
       * 큰 것</b>이고(상류 본문 한도 ~100KB), 그때는 기다려도 같은 결과다. 강사가 지금 할 수 있는
       * 일을 알려 준다.
       */
      setFailure('판서를 정리하지 못했습니다. 선택 범위를 좁혀 다시 시도해 주세요.')
    } finally {
      setBusyAction(null)
    }
  }, [applyResult, exportSelectionPng, selectedElements, sessionId])


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
        ? orderedForScene([whiteboardElement(), ...current])
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
   * 판서를 켤 때, 그리고 새 참가자가 들어올 때마다 <b>전체 상태를 알린다</b>.
   *
   * <p>두 가지를 한다. 도중에 접속한 Egress는 그 전에 흐른 op를 받을 수 없으므로 <b>판서가 빈 채로
   * 녹화되는 것</b>을 막고, 동시에 수신 측의 <b>revision 기준점</b>을 잡는다.
   *
   * <p><b>문서를 싣지 않는다</b>(ADR-0055). 예전에는 여기서 스냅샷을 통째로 밀었는데, 실측에서
   * 요소 53개 + 수식 1개가 74.9KB로 데이터 채널 한도(64KB)를 넘었다. 넘으면 전송이 통째로 실패해
   * 수강생 화면에 판서가 아예 나오지 않는다 — 강사 화면에는 멀쩡히 보이므로 알아챌 수 없다.
   * 대신 포인터를 내고 수신 측이 서버에서 받아간다.
   *
   * <p><b>비어 있어도 알린다.</b> Egress는 revision 0에서 시작하는데 강사는 서버에서 이어받은 번호
   * (예: 48)부터 매긴다. 기준점이 없으면 이후 op가 전부 "중간이 빠졌다"로 버려져 — 강사 화면에는
   * 그려지는데 수강생 화면에는 아무것도 나타나지 않는다.
   */
  useEffect(() => {
    if (!active) return
    onPublishState(() => ({
      type: 'snapshot',
      elements: elementsRef.current,
      files: referencedFiles(elementsRef.current, filesRef.current),
    }))
  }, [active, audienceRevision, onPublishState])

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
  const ringOpen = selectedIds.length > 0 || ringExpanded
  const mathLatex = selectedMathLatex()
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
          {/*
            판서를 한 번에 비운다. 지우개로 하나씩 지우는 것보다 빠르다.

            기본 `ClearCanvas` 대신 우리 것을 넣는다 — 기본 항목은 배경색까지 되돌려 영상을 흰 판으로
            덮는다(이유는 `clearAnnotations` 참고). 이름도 하는 일에 맞춘다: 캔버스 설정은 그대로고
            지워지는 것은 판서뿐이다.
          */}
          <MainMenu.Item onSelect={clearAnnotations}>판서 초기화</MainMenu.Item>
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
      {!ringOpen && hasElements && (
        <button type="button" className="annotation-interpret-entry" onClick={startPicking}>
          <span aria-hidden="true">✨</span> AI로 정리
        </button>
      )}

      {/*
        강조 툴(ADR-0074). "AI로 정리"와 하는 일이 다르다 — 정리는 판서를 <b>바꾸고</b>, 강조는 그
        순간의 화면을 <b>근거로 남긴다</b>. 그래서 진입점을 따로 둔다.

        진짜 커스텀 툴 타입을 만들지 않는다. freedraw에 전용 색·투명도를 얹고 customData로 표식만
        붙인다 — 그래야 이 획이 일반 판서와 <b>같은 op 경로</b>를 타서 수강생 화면·Egress 녹화·다시보기에
        그대로 나가고, 지우개로도 지워진다. customType으로 새 툴을 만들면 그 경로를 전부 따로 배선해야 한다.
      */}
      {onHighlightSettled && (
        <button
          type="button"
          className={`annotation-highlight-entry${highlightMode ? ' annotation-highlight-entry--on' : ''}`}
          aria-pressed={highlightMode}
          onClick={toggleHighlightTool}
        >
          <span aria-hidden="true">🖍</span> {highlightMode ? '강조 끄기' : '강조'}
        </button>
      )}

      {/*
        우리가 넣은 수식을 고르면 "고치기"를 띄운다. 그림이 되면 내용을 못 고치므로, 붙여 둔 LaTeX를
        꺼내 다시 렌더하는 것이 유일한 편집 경로다(ADR-0051의 "고칠 수 있어야 한다").
      */}
      {mathLatex !== null && editingMath === null && (
        <button
          type="button"
          className="annotation-math-edit"
          onClick={() => setEditingMath(mathLatex)}
        >
          수식 고치기
        </button>
      )}

      {editingMath !== null && (
        <form
          className="annotation-math-editor"
          onSubmit={(event) => { event.preventDefault(); void reeditMath(editingMath) }}
        >
          <label htmlFor="annotation-math-input">LaTeX</label>
          <input
            id="annotation-math-input"
            value={editingMath}
            onChange={(event) => setEditingMath(event.target.value)}
            autoFocus
            spellCheck={false}
          />
          <button type="button" onClick={() => setEditingMath(null)}>취소</button>
          <button type="submit" className="is-primary" disabled={busyAction === 'math'}>
            {busyAction === 'math' ? '고치는 중…' : '다시 렌더'}
          </button>
        </form>
      )}

      {ringOpen && center && editingMath === null && (
        <AnnotationActionRing
          center={center}
          actions={INTERPRET_ACTIONS}
          busyActionId={busyAction}
          needsSelection={selectedIds.length === 0}
          onPick={(id) => { void runInterpret(id as InterpretMode) }}
          onDismiss={() => { setSelectedIds([]); setRingExpanded(false) }}
        />
      )}

      {applied && (
        <p className="annotation-interpret-applied" role="status">
          {applied} · 되돌리려면 <kbd>Ctrl</kbd>+<kbd>Z</kbd>
        </p>
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
