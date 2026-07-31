import { resolveCsrfHeader } from '@/shared/api/client'
import type { AnnotationElement } from './annotation'

/**
 * 판서 해석(ADR-0054, CONTRACT §3-6e).
 *
 * <p><b>서버는 좌표를 돌려주지 않는다.</b> 모델에게 위치를 묻지 않기 때문이다 — 실측에서 모델이 낸
 * 도형 좌표는 최대 96px(그림 크기의 2~13%) 틀렸고, 같은 좌표를 우리는 획의 점에서 오차 없이 갖고
 * 있다. 그래서 서버는 <b>의미</b>만 주고(mermaid 정의 또는 LaTeX), <b>어디에 어떤 크기로 놓을지는
 * 이 모듈이 정한다</b>.
 *
 * <p>결과를 화면에 바로 넣지 않는다. 강사가 확인한 뒤 적용한다 — 모델이 낸 `confidence`는 근거가
 * 되지 못한다(실측에서 틀린 한글 라벨에 1.0이 붙었다).
 */

export type InterpretMode = 'diagram' | 'math'

export interface AnnotationInterpretation {
  kind: 'mermaid' | 'latex'
  /** mermaid 정의 전체 또는 LaTeX 수식. `unreadable`이면 빈 문자열. */
  body: string
  /** 지울 요소 id. 강사가 선택한 것들이다. */
  replace: string[]
  /** 모델이 스스로 매긴 값. <b>자동 적용의 근거로 쓰지 않는다.</b> 강사에게 보여 주는 참고값이다. */
  confidence: number
  unreadable: boolean
}

/** 선택한 요소를 감싸는 사각형. 해석 결과를 어디에 놓을지의 기준이다. */
export interface SelectionBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 선택한 요소들의 실제 bbox.
 *
 * <p><b>선언된 `x/y/width/height`를 쓰지 않고 `points`를 편다.</b> `freedraw`의 점은 선언된 상자를
 * 넘어갈 수 있어서(§3-6b에서 이미 겪었다) 그대로 쓰면 정리된 도형이 원본에서 밀린다.
 */
export function selectionBounds(elements: readonly AnnotationElement[]): SelectionBounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const element of elements) {
    const originX = typeof element.x === 'number' ? element.x : 0
    const originY = typeof element.y === 'number' ? element.y : 0
    const points = Array.isArray(element.points) ? element.points : null
    if (points && points.length > 0) {
      for (const point of points as [number, number][]) {
        minX = Math.min(minX, originX + point[0])
        minY = Math.min(minY, originY + point[1])
        maxX = Math.max(maxX, originX + point[0])
        maxY = Math.max(maxY, originY + point[1])
      }
      continue
    }
    const width = typeof element.width === 'number' ? element.width : 0
    const height = typeof element.height === 'number' ? element.height : 0
    minX = Math.min(minX, originX)
    minY = Math.min(minY, originY)
    maxX = Math.max(maxX, originX + width)
    maxY = Math.max(maxY, originY + height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
}

/**
 * 변환된 요소를 <b>원래 그린 자리로</b> 옮긴다.
 *
 * <p>여기가 ADR-0054의 핵심이 실제로 사는 곳이다. 모델은 위치를 말하지 않았고, mermaid는 자기
 * 원점에서 배치를 계산했다. 그 결과를 강사가 그렸던 자리에 겹쳐 놓는 일은 <b>우리가</b> 한다 —
 * 원본 획의 bbox를 알고 있으므로 추측이 필요 없다.
 *
 * <p><b>크기는 건드리지 않는다.</b> 늘리면 글자만 뭉개지고, 줄이면 읽을 수 없게 된다. 대신
 * <b>가운데를 맞춘다</b> — 정리된 그림이 손그림이 있던 자리에 그대로 나타나는 것이 강사가 기대하는
 * 모습이고, 크기 조절은 Excalidraw가 이미 잘 하는 일이다.
 */
export function placeAtSelection<T extends AnnotationElement>(
  elements: readonly T[],
  bounds: SelectionBounds,
): T[] {
  const converted = selectionBounds(elements)
  if (!converted) return [...elements]

  const dx = bounds.x + (bounds.width - converted.width) / 2 - converted.x
  const dy = bounds.y + (bounds.height - converted.height) / 2 - converted.y

  return elements.map((element) => ({
    ...element,
    x: (typeof element.x === 'number' ? element.x : 0) + dx,
    y: (typeof element.y === 'number' ? element.y : 0) + dy,
  }))
}

/**
 * 인식한 수식을 넣을 글자 크기.
 *
 * <p>Excalidraw에는 수식 렌더가 없어 LaTeX를 <b>글자 그대로</b> 넣는다. 크기는 원본 손글씨의
 * 높이에서 가져온다 — 강사가 크게 썼으면 크게, 작게 썼으면 작게 나오는 편이 자연스럽다.
 *
 * <p><b>자리는 여기서 정하지 않는다.</b> 다이어그램과 마찬가지로 {@link placeAtSelection}이 원본이
 * 있던 자리의 가운데로 옮긴다 — 여기서 좌표까지 돌려주면 그 값이 뒤에서 덮여 죽은 코드가 된다.
 */
export function latexFontSize(bounds: SelectionBounds): number {
  return Math.min(72, Math.max(16, Math.round(bounds.height * 0.7)))
}

/**
 * 서버에 해석을 요청한다.
 *
 * <p>브라우저가 모델 게이트웨이를 직접 부르지 않는다 — API 키가 클라이언트로 나가는 순간 누구나
 * 우리 이름으로 모델을 부를 수 있다. 반드시 Spring을 거친다(ADR-0054).
 */
export async function interpretAnnotation(
  sessionId: string,
  mode: InterpretMode,
  imageDataUri: string,
  elementIds: readonly string[],
): Promise<AnnotationInterpretation> {
  const response = await fetch(`/api/live-sessions/${sessionId}/annotation/interpret`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(await resolveCsrfHeader()) },
    body: JSON.stringify({ mode, image: imageDataUri, elementIds: [...elementIds] }),
  })
  if (!response.ok) {
    throw new Error(`판서 해석에 실패했습니다: ${response.status}`)
  }
  return (await response.json()) as AnnotationInterpretation
}
