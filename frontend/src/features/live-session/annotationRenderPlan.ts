import { visibleAnnotationElements, type AnnotationDocument, type AnnotationElement } from './annotation'

/**
 * Egress 판서 렌더를 두 겹으로 나누는 계획(ADR-0051 후속).
 *
 * <p><b>왜 나누는가.</b> 지금은 op 하나가 올 때마다 문서 <b>전체</b>를 다시 export한다. ADR-0051
 * 실측으로 획 50개에 32.5ms, 200개에 55.1ms인데 op 도착 간격은 33.6ms다 — 획이 50개를 넘는
 * 순간부터 렌더가 도착 속도를 따라가지 못하고, 그 뒤로는 강의가 길어질수록 수강생 화면이 더
 * 뒤처진다. 지금 그리는 중인 획 하나만 따로 얹으면 op당 비용이 요소 1개짜리 export로 내려간다.
 *
 * <p><b>왜 op 종류로 판단하지 않는가.</b> "요소 하나짜리 upsert = 지금 긋는 획"은 틀렸다. 기존
 * 요소를 옮겨도, 화이트보드를 갱신해도 같은 모양의 op가 나온다. 화이트보드는 프레임 전체를 덮는
 * <b>불투명</b> 판이라(annotation.ts의 whiteboardElement) 그걸 위 겹에 올리면 합성 화면이 통째로
 * 하얘진다.
 *
 * <p>그래서 op를 보지 않고 <b>문서를 비교한다.</b> 마지막 요소를 뺀 나머지가 직전에 그린 것과
 * 순서·내용까지 같을 때만 아래 겹을 재사용한다. 이 조건이면 위 겹에 올라가는 요소는 정의상 z-order
 * 맨 위이므로, <b>두 겹을 포갠 결과가 한 번에 그린 것과 같다.</b>
 *
 * <p>이 불변식은 깨져도 <b>강사 화면에서는 드러나지 않는다</b> — 녹화와 수강생 화면에서만 어긋난다.
 * ADR-0056이 z-order로 두 번 겪은 그 모양이라, 판단을 순수 함수로 떼어 계약 테스트로 고정한다.
 */

/** 렌더 계획. `settled`(아래) 위에 `active`(위) 한 장을 얹는다. */
export interface AnnotationRenderPlan {
  /**
   * 아래 겹을 다시 그려야 하는가. <b>false면 지난 캔버스를 그대로 둔다</b> — 이 절약이 이 설계의
   * 전부다.
   */
  redrawSettled: boolean
  /** 아래 겹에 그릴 요소. z-order 순이다. */
  settled: AnnotationElement[]
  /** 위에 얹을 요소 하나. 문서가 비었으면 null이다. */
  active: AnnotationElement | null
}

/**
 * 아래 겹을 그대로 쓸 수 있는가.
 *
 * <p><b>version까지 본다.</b> id만 비교하면 아래 깔린 요소를 강사가 옮기거나 색을 바꿨을 때 그것을
 * 못 알아채고 옛 그림을 계속 보여 준다. Excalidraw는 요소가 바뀔 때마다 version을 올리므로
 * ({@link import('./annotation').diffAnnotationElements}가 같은 값을 근거로 쓴다) 이 비교면 충분하다.
 */
export function canReuseSettled(
  settled: readonly AnnotationElement[],
  ordered: readonly AnnotationElement[],
): boolean {
  // 아래 겹 + 위 한 장이 정확히 지금 문서여야 한다. 요소가 지워졌거나 여러 개가 늘었으면 다시 그린다.
  if (ordered.length !== settled.length + 1) return false
  for (let index = 0; index < settled.length; index += 1) {
    const before = settled[index]
    const now = ordered[index]
    if (before.id !== now.id) return false
    if ((before.version ?? 0) !== (now.version ?? 0)) return false
  }
  return true
}

/**
 * 지금 문서를 두 겹으로 나눈다.
 *
 * <p>나누는 자리는 <b>언제나 마지막 요소 앞</b>이다. 그래서 `settled ++ [active]`는 항상
 * {@link visibleAnnotationElements}와 같고, 두 겹을 포갠 그림이 한 번에 그린 것과 다를 수 없다.
 * 달라지는 것은 "아래 겹을 다시 그리느냐"뿐이다.
 *
 * @param previousSettled 직전에 아래 겹으로 그린 요소. 아직 아무것도 안 그렸으면 null.
 */
export function planAnnotationRender(
  previousSettled: readonly AnnotationElement[] | null,
  document: AnnotationDocument,
): AnnotationRenderPlan {
  const ordered = visibleAnnotationElements(document)
  if (ordered.length === 0) {
    return { redrawSettled: true, settled: [], active: null }
  }

  const settled = ordered.slice(0, -1)
  const active = ordered[ordered.length - 1]
  const reuse = previousSettled !== null && canReuseSettled(previousSettled, ordered)
  return { redrawSettled: !reuse, settled, active }
}
