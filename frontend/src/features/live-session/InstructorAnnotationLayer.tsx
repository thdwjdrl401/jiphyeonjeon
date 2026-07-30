import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import {
  diffAnnotationElements,
  type AnnotationChange,
  type AnnotationElement,
} from './annotation'
import { loadExcalidraw } from './excalidrawRuntime'

interface InstructorAnnotationLayerProps {
  /** 판서를 켜 둔 동안만 mount한다. 껐을 때 무거운 에디터를 붙여 둘 이유가 없다. */
  active: boolean
  /** 판서 변경을 데이터 채널로 내보낸다. */
  onPublish: (change: AnnotationChange) => void
  /** 새 참가자가 들어올 때마다 오르는 값. 오르면 스냅샷을 다시 내보낸다. */
  audienceRevision: number
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
}: InstructorAnnotationLayerProps) {
  const [Excalidraw, setExcalidraw] = useState<ComponentType<Record<string, unknown>> | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  /** 지금까지 내보낸 요소의 `id → version`. 바뀐 것만 골라내는 기준이다. */
  const knownRef = useRef(new Map<string, number>())
  /** 마지막으로 본 전체 요소. 스냅샷을 다시 낼 때 쓴다. */
  const elementsRef = useRef<AnnotationElement[]>([])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadExcalidraw()
      .then((module) => {
        if (cancelled) return
        // 컴포넌트를 state에 담을 때는 반드시 함수로 감싼다. 그냥 넘기면 React가 <b>업데이터 함수</b>로
        // 보고 컴포넌트를 호출해 그 반환값(JSX)을 state에 넣는다 — 렌더에서 "Element type is invalid"로
        // 터진다.
        setExcalidraw(() => module.Excalidraw as unknown as ComponentType<Record<string, unknown>>)
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
    elementsRef.current = elements.filter((element) => element.isDeleted !== true)
    const { changes, known } = diffAnnotationElements(knownRef.current, elements)
    knownRef.current = known
    for (const change of changes) onPublish(change)
  }, [onPublish])

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

  if (!active) return null

  if (loadFailed) {
    return (
      <div className="instructor-annotation-layer instructor-annotation-layer--failed" role="alert">
        판서 편집기를 불러오지 못했습니다. 다시 시도하려면 판서를 끄고 켜 주세요.
      </div>
    )
  }

  // 청크(+365KB gzip)가 내려오는 동안. 아래 영상은 계속 보여야 하므로 자리만 잡고 비워 둔다.
  if (!Excalidraw) return <div className="instructor-annotation-layer instructor-annotation-layer--loading" aria-busy="true" />

  return (
    <div className="instructor-annotation-layer">
      <Excalidraw
        onChange={handleChange}
        initialData={{
          appState: {
            // 화면공유가 아래에 깔리므로 배경을 칠하면 안 된다.
            viewBackgroundColor: 'transparent',
            // 판서는 늘 프레임에 1:1로 대응해야 한다. 강사가 확대·이동하면 강사가 보는 자리와
            // 합성에 나가는 자리가 달라진다.
            zoom: { value: 1 },
            scrollX: 0,
            scrollY: 0,
          },
          scrollToContent: false,
        }}
      />
    </div>
  )
}
