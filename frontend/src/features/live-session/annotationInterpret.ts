import { resolveCsrfHeader } from '@/shared/api/client'
import type { AnnotationElement } from './annotation'

/**
 * 판서 해석(ADR-0054, CONTRACT §3-6e).
 *
 * <p><b>서버는 좌표를 돌려주지 않는다.</b> 모델에게 위치를 묻지 않기 때문이다 — 실측에서 모델이 낸
 * 도형 좌표는 최대 96px(그림 크기의 2~13%) 틀렸고, 같은 좌표를 우리는 획의 점에서 오차 없이 갖고
 * 있다. 그래서 서버는 <b>의미</b>만 주고(mermaid 정의 또는 유니코드 수식), <b>어디에 어떤 크기로 놓을지는
 * 이 모듈이 정한다</b>.
 *
 * <p>결과를 화면에 바로 넣지 않는다. 강사가 확인한 뒤 적용한다 — 모델이 낸 `confidence`는 근거가
 * 되지 못한다(실측에서 틀린 한글 라벨에 1.0이 붙었다).
 */

export type InterpretMode = 'diagram' | 'math'

export interface AnnotationInterpretation {
  kind: 'mermaid' | 'math'
  /**
   * 판서에 <b>그대로 넣을</b> 것. 다이어그램은 mermaid 정의, 수식은 유니코드 문자열이다.
   *
   * <p>수식이 LaTeX가 아닌 이유: Excalidraw에는 수식 렌더러가 없어 `y = ax^2 + bx + c`를 넣으면
   * 글자 그대로 보인다. 이미지로 넣는 방법은 못 쓴다 — 데이터 채널로 파일이 흐르지 않아 수강생
   * 화면에 나타나지 않는다(강사 화면 = 수강생 화면).
   */
  body: string
  /** 수식일 때의 LaTeX 원문. 지금은 넣지 않고 다시보기 앵커·그래프·RAG에 쓰려고 받아 둔다. */
  source: string
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
 * 변환된 요소를 <b>원래 그린 자리·크기에</b> 맞춘다.
 *
 * <p>여기가 ADR-0054의 핵심이 실제로 사는 곳이다. 모델은 위치도 크기도 말하지 않았고, mermaid는
 * 자기 원점에서 자기 기준으로 배치했다. 강사가 그렸던 자리에 그만한 크기로 얹는 일은 <b>우리가</b>
 * 한다 — 원본 획의 bbox를 알고 있으므로 추측이 필요 없다.
 *
 * <p><b>비율은 유지한다.</b> 가로세로를 따로 늘리면 원이 타원이 되고 글자가 찌그러진다. 짧은 쪽에
 * 맞춰 균일하게 줄이고 남는 방향은 가운데로 둔다.
 *
 * <p>글자 크기도 함께 곱한다. 상자만 줄이고 글자를 그대로 두면 라벨이 상자를 삐져나온다.
 */
export function placeAtSelection<T extends AnnotationElement>(
  elements: readonly T[],
  bounds: SelectionBounds,
): T[] {
  const converted = selectionBounds(elements)
  if (!converted) return [...elements]

  const scale = fitScale(converted, bounds)
  const dx = bounds.x + (bounds.width - converted.width * scale) / 2
  const dy = bounds.y + (bounds.height - converted.height * scale) / 2

  return elements.map((element) => {
    const originX = typeof element.x === 'number' ? element.x : 0
    const originY = typeof element.y === 'number' ? element.y : 0
    const scaled: Record<string, unknown> = {
      ...element,
      x: dx + (originX - converted.x) * scale,
      y: dy + (originY - converted.y) * scale,
    }
    if (typeof element.width === 'number') scaled.width = element.width * scale
    if (typeof element.height === 'number') scaled.height = element.height * scale
    if (typeof element.fontSize === 'number') scaled.fontSize = element.fontSize * scale
    if (Array.isArray(element.points)) {
      scaled.points = (element.points as [number, number][]).map(([x, y]) => [x * scale, y * scale])
    }
    return scaled as T
  })
}

/**
 * 원본 자리에 들어가도록 줄일 배율.
 *
 * <p>원본보다 작게 그려졌으면 <b>키우지 않는다</b>. mermaid가 낸 그림이 이미 읽을 만한 크기인데
 * 강사가 작게 스케치했다고 억지로 늘리면 글자만 뭉개진다 — 남는 자리는 그냥 비워 둔다.
 */
function fitScale(converted: SelectionBounds, bounds: SelectionBounds): number {
  const byWidth = converted.width > 0 ? bounds.width / converted.width : 1
  const byHeight = converted.height > 0 ? bounds.height / converted.height : 1
  const fit = Math.min(byWidth, byHeight)
  if (!Number.isFinite(fit) || fit <= 0) return 1
  return Math.min(1, fit)
}

/**
 * 인식한 수식을 넣을 글자 크기.
 *
 * <p>수식은 유니코드 글자로 들어간다(Excalidraw에 수식 렌더러가 없다). 크기는 원본 손글씨의
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
