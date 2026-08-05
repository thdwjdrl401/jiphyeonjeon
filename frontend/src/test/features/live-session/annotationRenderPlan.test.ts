import { describe, expect, it } from 'vitest'
import {
  visibleAnnotationElements,
  WHITEBOARD_ELEMENT_ID,
  whiteboardElement,
  type AnnotationDocument,
  type AnnotationElement,
} from '@/features/live-session/annotation'
import { canReuseSettled, planAnnotationRender } from '@/features/live-session/annotationRenderPlan'

/**
 * Egress 두 겹 렌더 계약(ADR-0051 후속).
 *
 * <p>여기서 지키는 것은 속도가 아니라 <b>순서</b>다. 두 겹을 포갠 결과가 한 번에 그린 것과 달라지면
 * 강사 화면은 멀쩡한데 녹화와 수강생 화면만 어긋난다 — ADR-0056이 z-order로 두 번 겪은 그 모양이다.
 */

/** fractional index를 붙인 요소. 실제로 Excalidraw가 채워 주는 값이다. */
function element(id: string, index: string, version = 1): AnnotationElement {
  return { id, index, version, type: 'freedraw' }
}

function documentOf(elements: AnnotationElement[], revision = 1): AnnotationDocument {
  return { revision, elements, files: {} }
}

describe('판서 렌더 두 겹 나누기', () => {
  /**
   * <b>이 파일에서 가장 중요한 단언이다.</b> 나머지 테스트가 전부 통과해도 이게 깨지면 합성 화면이
   * 강사 화면과 달라진다.
   */
  it('불변식: settled + active는 언제나 visibleAnnotationElements와 같다', () => {
    const cases: AnnotationDocument[] = [
      documentOf([]),
      documentOf([element('a', 'a0')]),
      documentOf([element('a', 'a0'), element('b', 'a1')]),
      // 도착 순과 z-order가 어긋난 경우 — index로 정렬해야 맞는다.
      documentOf([element('b', 'a2'), element('a', 'a1')]),
      // 화이트보드는 index와 무관하게 맨 아래로 강제된다.
      documentOf([element('a', 'a0'), whiteboardElement()]),
      documentOf([whiteboardElement(), element('a', 'a0'), element('b', 'a1')]),
      // 지운 요소는 배열에 남지만 그려지지 않는다.
      documentOf([element('a', 'a0'), { ...element('b', 'a1'), isDeleted: true }]),
    ]

    for (const document of cases) {
      const plan = planAnnotationRender(null, document)
      const composed = plan.active === null ? plan.settled : [...plan.settled, plan.active]
      expect(composed).toEqual(visibleAnnotationElements(document))
    }
  })

  it('빈 문서는 두 겹 다 비운다', () => {
    expect(planAnnotationRender(null, documentOf([]))).toEqual({
      redrawSettled: true, settled: [], active: null,
    })
  })

  it('처음 그릴 때는 아래 겹도 그린다 — 재사용할 것이 없다', () => {
    const plan = planAnnotationRender(null, documentOf([element('a', 'a0'), element('b', 'a1')]))
    expect(plan.redrawSettled).toBe(true)
    expect(plan.settled.map((e) => e.id)).toEqual(['a'])
    expect(plan.active?.id).toBe('b')
  })

  /**
   * 획 하나를 긋는 동안 점이 늘 때마다 op가 온다(실측 40건). 그때마다 문서 전체를 다시 그리면
   * 획이 쌓일수록 밀린다 — 여기가 이 설계가 노리는 유일한 자리다.
   */
  it('그리는 중인 획이 자라도 아래 겹은 다시 그리지 않는다', () => {
    const settled = [element('a', 'a0'), element('b', 'a1')]
    const growing = element('c', 'a2', 7)
    const plan = planAnnotationRender(settled, documentOf([...settled, growing]))

    expect(plan.redrawSettled).toBe(false)
    expect(plan.active?.id).toBe('c')
  })

  it('새 획이 시작되면 직전 획이 아래로 내려가므로 한 번만 다시 그린다', () => {
    const settled = [element('a', 'a0')]
    const document = documentOf([element('a', 'a0'), element('b', 'a1'), element('c', 'a2')])

    const plan = planAnnotationRender(settled, document)
    expect(plan.redrawSettled).toBe(true)
    expect(plan.settled.map((e) => e.id)).toEqual(['a', 'b'])
    expect(plan.active?.id).toBe('c')

    // 그 다음 op부터는 다시 재사용된다.
    const next = planAnnotationRender(plan.settled, documentOf([
      element('a', 'a0'), element('b', 'a1'), element('c', 'a2', 9),
    ]))
    expect(next.redrawSettled).toBe(false)
  })

  /* ── 여기부터가 위험 구간이다. 전부 "다시 그린다"로 물러서야 한다. ─────────── */

  /**
   * <b>아래 깔린 요소를 옮기는 경우.</b> 요소 하나짜리 upsert라는 점에서 획을 긋는 것과 구별되지
   * 않는다 — op 종류로 판단했다면 여기서 옛 그림이 남는다.
   */
  it('아래 깔린 요소가 바뀌면 다시 그린다', () => {
    const settled = [element('a', 'a0', 1), element('b', 'a1', 1)]
    const plan = planAnnotationRender(settled, documentOf([
      element('a', 'a0', 2),   // version이 올랐다 = 옮겼거나 색을 바꿨다
      element('b', 'a1', 1),
      element('c', 'a2'),
    ]))
    expect(plan.redrawSettled).toBe(true)
  })

  /**
   * <b>화이트보드.</b> 프레임 전체를 덮는 불투명 판이라 위 겹에 올리면 합성 화면이 통째로 하얘진다.
   * visibleAnnotationElements가 맨 아래로 강제하므로 active가 될 수 없고, 그것이 갱신되면 아래 겹이
   * 바뀌므로 다시 그린다.
   */
  it('화이트보드는 위 겹에 올라가지 않는다', () => {
    const plan = planAnnotationRender(null, documentOf([element('a', 'a0'), whiteboardElement()]))
    expect(plan.active?.id).toBe('a')
    expect(plan.settled.map((e) => e.id)).toEqual([WHITEBOARD_ELEMENT_ID])
  })

  it('화이트보드만 있으면 그것이 위 겹이고 아래는 비어 있다 — 포갠 결과는 같다', () => {
    const document = documentOf([whiteboardElement()])
    const plan = planAnnotationRender(null, document)
    expect(plan.settled).toEqual([])
    expect(plan.active?.id).toBe(WHITEBOARD_ELEMENT_ID)
    expect([...plan.settled, plan.active!]).toEqual(visibleAnnotationElements(document))
  })

  it('화이트보드가 갱신되면 다시 그린다', () => {
    const settled = [whiteboardElement(), element('a', 'a0')]
    const plan = planAnnotationRender(settled, documentOf([
      { ...whiteboardElement(), version: 2, backgroundColor: '#000000' },
      element('a', 'a0'),
      element('b', 'a1'),
    ]))
    expect(plan.redrawSettled).toBe(true)
  })

  it('요소가 지워지면 다시 그린다', () => {
    const settled = [element('a', 'a0'), element('b', 'a1')]
    // 지우개로 b가 빠졌다. 길이가 줄어 재사용 조건에 걸리지 않는다.
    const plan = planAnnotationRender(settled, documentOf([element('a', 'a0'), element('c', 'a2')]))
    expect(plan.redrawSettled).toBe(true)
    expect(plan.settled.map((e) => e.id)).toEqual(['a'])
  })

  it('한 번에 여러 요소가 늘면 다시 그린다', () => {
    const settled = [element('a', 'a0')]
    const plan = planAnnotationRender(settled, documentOf([
      element('a', 'a0'), element('b', 'a1'), element('c', 'a2'), element('d', 'a3'),
    ]))
    expect(plan.redrawSettled).toBe(true)
  })

  /**
   * <b>Layers(앞으로 보내기).</b> 요소 내용은 그대로인데 index만 바뀐다 — 순서가 뒤집혔는데
   * version 비교만으로는 못 잡을 수 있으므로, id 순서까지 비교하는 것이 필요하다.
   */
  it('순서만 바뀌어도 다시 그린다', () => {
    const settled = [element('a', 'a0'), element('b', 'a1')]
    const plan = planAnnotationRender(settled, documentOf([
      { ...element('a', 'a0'), index: 'a5' },   // a를 b 위로 올렸다
      element('b', 'a1'),
      element('c', 'a9'),
    ]))
    expect(plan.redrawSettled).toBe(true)
    expect(plan.settled.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('스냅샷·pointer로 문서가 통째로 갈리면 다시 그린다', () => {
    const settled = [element('a', 'a0'), element('b', 'a1')]
    const plan = planAnnotationRender(settled, documentOf([element('x', 'b0'), element('y', 'b1')]))
    expect(plan.redrawSettled).toBe(true)
  })

  it('문서가 비면 아래 겹을 지운다 — 옛 그림이 남으면 clear가 먹지 않은 것처럼 보인다', () => {
    const plan = planAnnotationRender([element('a', 'a0')], documentOf([]))
    expect(plan).toEqual({ redrawSettled: true, settled: [], active: null })
  })

  describe('canReuseSettled', () => {
    it('길이가 정확히 하나 늘었을 때만 재사용한다', () => {
      const settled = [element('a', 'a0')]
      expect(canReuseSettled(settled, [element('a', 'a0'), element('b', 'a1')])).toBe(true)
      expect(canReuseSettled(settled, [element('a', 'a0')])).toBe(false)
      expect(canReuseSettled(settled, [element('a', 'a0'), element('b', 'a1'), element('c', 'a2')]))
        .toBe(false)
    })

    it('version이 없어도 비교가 성립한다 — 옛 op는 그 필드를 갖지 않는다', () => {
      const before: AnnotationElement[] = [{ id: 'a', type: 'freedraw' }]
      expect(canReuseSettled(before, [{ id: 'a', type: 'freedraw' }, element('b', 'a1')])).toBe(true)
      expect(canReuseSettled(before, [{ id: 'a', type: 'freedraw', version: 2 }, element('b', 'a1')]))
        .toBe(false)
    })
  })
})
