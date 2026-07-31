import { describe, expect, it } from 'vitest'
import type { AnnotationElement } from '@/features/live-session/annotation'
import {
  latexFontSize,
  placeAtSelection,
  selectionBounds,
} from '@/features/live-session/annotationInterpret'

/**
 * 판서 해석의 <b>좌표 쪽</b> 계약(ADR-0054, CONTRACT §3-6e).
 *
 * <p>서버는 의미만 준다 — mermaid 정의나 LaTeX 문자열이고, 좌표는 한 개도 실려 있지 않다. 실측에서
 * 모델이 낸 도형 좌표가 최대 96px(그림 크기의 2~13%) 틀렸기 때문이다. 그래서 "어디에 놓을지"는
 * 전부 이 모듈이 원본 획에서 계산하고, 여기서 고정하는 것이 그 계산이다.
 */

function stroke(id: string, x: number, y: number, points: [number, number][]): AnnotationElement {
  return { id, type: 'freedraw', version: 1, x, y, points } as unknown as AnnotationElement
}

function box(id: string, x: number, y: number, width: number, height: number): AnnotationElement {
  return { id, type: 'rectangle', version: 1, x, y, width, height } as unknown as AnnotationElement
}

describe('선택 영역 bbox', () => {
  /**
   * `freedraw`의 점은 선언된 `x/y/width/height` 상자를 넘어갈 수 있다. 선언값을 믿으면 정리된
   * 도형이 손그림에서 밀리는데, <b>강사 화면에서는 드러나지 않는다</b>(§3-6b에서 겪은 그 문제다).
   */
  it('선언된 상자가 아니라 실제 점에서 잰다', () => {
    // 선언은 (100,100)인데 점이 음수·초과로 뻗어 있다.
    const element = stroke('a', 100, 100, [[0, 0], [-40, -30], [260, 180]])

    expect(selectionBounds([element])).toEqual({ x: 60, y: 70, width: 300, height: 210 })
  })

  it('점이 없는 요소는 선언된 크기를 쓴다', () => {
    expect(selectionBounds([box('a', 10, 20, 100, 50)]))
      .toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('여러 요소를 함께 감싼다', () => {
    const bounds = selectionBounds([box('a', 0, 0, 10, 10), box('b', 90, 40, 10, 10)])

    expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })

  it('선택이 비면 null이다 — 놓을 자리를 정할 근거가 없다', () => {
    expect(selectionBounds([])).toBeNull()
  })
})

describe('변환 결과 배치', () => {
  /**
   * mermaid는 자기 원점에서 배치를 계산한다. 그 결과를 강사가 그렸던 자리에 겹쳐 놓는 일은 우리가
   * 한다 — 원본 bbox를 알고 있으므로 추측이 필요 없다.
   */
  it('손그림이 있던 자리에 맞춰 옮기고 키운다', () => {
    // mermaid가 (0,0)-(100,50)에 그린 결과
    const converted = [box('m1', 0, 0, 40, 50), box('m2', 60, 0, 40, 50)]
    // 강사는 (500,300)-(800,500)에 그렸다 → 짧은 쪽(가로) 기준 3배
    const placed = placeAtSelection(converted, { x: 500, y: 300, width: 300, height: 200 })

    // 가로는 꽉 차고(300), 세로는 150이라 (200-150)/2 = 25 만큼 안쪽으로
    expect(placed.map((e) => [e.x, e.y])).toEqual([[500, 325], [680, 325]])
  })

  /**
   * 정리한 그림이 손그림보다 훨씬 크면 옆의 판서를 덮는다. 원본이 차지하던 만큼으로 줄인다.
   */
  it('원본 자리에 들어가도록 줄인다', () => {
    // mermaid가 (0,0)-(400,200)에 그렸는데 강사는 (0,0)-(200,200)에 스케치했다
    const converted = [box('m1', 0, 0, 400, 200)]

    const placed = placeAtSelection(converted, { x: 0, y: 0, width: 200, height: 200 })

    // 짧은 쪽(가로) 기준 0.5배
    expect(placed[0].width).toBe(200)
    expect(placed[0].height).toBe(100)
  })

  /** 가로세로를 따로 늘리면 원이 타원이 되고 글자가 찌그러진다. */
  it('비율을 유지한다', () => {
    const converted = [box('m1', 0, 0, 400, 100)]

    const placed = placeAtSelection(converted, { x: 0, y: 0, width: 200, height: 200 })

    const shape = placed[0] as unknown as { width: number; height: number }
    expect(shape.width / shape.height).toBeCloseTo(4)
  })

  /** 상자만 줄이고 글자를 그대로 두면 라벨이 상자를 삐져나온다. */
  it('글자 크기도 함께 줄인다', () => {
    const text = { ...box('t1', 0, 0, 400, 100), fontSize: 40 }

    const placed = placeAtSelection([text] as AnnotationElement[], { x: 0, y: 0, width: 200, height: 100 })

    expect((placed[0] as { fontSize?: number }).fontSize).toBe(20)
  })

  /** 획으로 이뤄진 요소는 점까지 줄여야 한다 — 상자만 줄이면 선이 상자 밖으로 뻗는다. */
  it('선의 점도 함께 줄인다', () => {
    const line = { id: 'l1', type: 'line', version: 1, x: 0, y: 0, points: [[0, 0], [400, 0]] }

    const placed = placeAtSelection([line] as unknown as AnnotationElement[], { x: 0, y: 0, width: 200, height: 200 })

    expect((placed[0] as unknown as { points: [number, number][] }).points[1][0]).toBe(200)
  })

  /**
   * 작게 나왔으면 키운다. 벡터 요소이고 글자 크기도 같은 배율로 곱하므로 키워도 선명하다 —
   * 강사가 크게 스케치했으면 정리된 그림도 그만큼 커야 "그 자리를 대신한" 것으로 보인다.
   */
  it('원본이 더 크면 키운다', () => {
    const converted = [{ ...box('m1', 0, 0, 40, 50), fontSize: 20 }]

    const placed = placeAtSelection(converted as AnnotationElement[], { x: 0, y: 0, width: 400, height: 500 })

    expect(placed[0].width).toBe(400)
    expect(placed[0].height).toBe(500)
    expect((placed[0] as { fontSize?: number }).fontSize).toBe(200)
  })

  /** 긴 쪽에 맞추면 원본 영역을 넘어가 옆의 판서를 덮는다. */
  it('짧은 쪽에 맞춘다', () => {
    const converted = [box('m1', 0, 0, 100, 100)]

    const placed = placeAtSelection(converted, { x: 0, y: 0, width: 600, height: 200 })

    expect(placed[0].width).toBe(200)
    expect(placed[0].height).toBe(200)
  })

  it('옮겨도 요소의 나머지 속성은 그대로다', () => {
    const converted = [{ ...box('m1', 0, 0, 10, 10), strokeColor: '#e03131', index: 'a1' }]

    const placed = placeAtSelection(converted as AnnotationElement[], { x: 5, y: 5, width: 10, height: 10 })

    expect(placed[0]).toMatchObject({ id: 'm1', strokeColor: '#e03131', index: 'a1' })
  })
})

describe('수식 글자 크기', () => {
  /** 강사가 크게 썼으면 크게, 작게 썼으면 작게 나오는 편이 자연스럽다. */
  it('원본 손글씨 높이에서 가져온다', () => {
    expect(latexFontSize({ x: 0, y: 0, width: 800, height: 100 })).toBe(70)
    expect(latexFontSize({ x: 0, y: 0, width: 200, height: 40 })).toBe(28)
  })

  /** 아주 작게 쓴 첨자나 아주 크게 쓴 제목에서도 읽을 수 있는 범위에 둔다. */
  it('너무 작거나 크지 않게 묶는다', () => {
    expect(latexFontSize({ x: 0, y: 0, width: 10, height: 5 })).toBe(16)
    expect(latexFontSize({ x: 0, y: 0, width: 10, height: 900 })).toBe(72)
  })
})
