import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_FRAME_HEIGHT,
  ANNOTATION_FRAME_WIDTH,
  annotationPlacement,
  applyAnnotationOp,
  decodeAnnotationOp,
  diffAnnotationElements,
  emptyAnnotationDocument,
  encodeAnnotationOp,
  visibleAnnotationElements,
  type AnnotationDocument,
  type AnnotationOp,
} from '@/features/live-session/annotation'

/**
 * 판서 배치 계약(ADR-0051).
 *
 * `exportToCanvas`는 프레임이 아니라 내용 바운딩 박스를 기준으로 그린다 — 내용을 `-minX,-minY`만큼
 * 평행이동시키고 캔버스도 내용 크기로 잡는다. 그래서 획을 더 그을 때마다 원점이 움직이고, 보정하지
 * 않으면 기존 판서가 영상 대비 밀린다.
 *
 * 이 어긋남은 **강사 화면에서는 드러나지 않는다**(강사는 에디터를 직접 보므로 항상 맞게 보인다).
 * 녹화와 수강생 화면에서만 틀리므로 눈으로는 잡을 수 없고, 이 테스트가 유일한 자물쇠다.
 */
describe('판서 배치 — 내용 바운딩 박스 오프셋 보정', () => {
  /** 배치 비율로 캔버스 안의 점을 프레임 좌표로 되돌린다. 실제 합성이 하는 일의 역산이다. */
  function toFrameCoords(
    placement: { x: number; y: number; w: number; h: number },
    canvas: { width: number; height: number },
    pointInCanvas: { x: number; y: number },
  ) {
    return {
      x: placement.x * ANNOTATION_FRAME_WIDTH + (pointInCanvas.x / canvas.width) * (placement.w * ANNOTATION_FRAME_WIDTH),
      y: placement.y * ANNOTATION_FRAME_HEIGHT + (pointInCanvas.y / canvas.height) * (placement.h * ANNOTATION_FRAME_HEIGHT),
    }
  }

  /**
   * ADR-0051의 실측 케이스를 그대로 고정한다. 프레임 좌표 (960,540)에 있는 마커가, 내용이 어떻게
   * 늘어나든 다시 (960,540)으로 복원되어야 한다.
   *
   * 마지막 두 케이스는 `freedraw`의 `points`가 선언된 bbox를 넘어가 바운딩 박스가 프레임 밖으로
   * 확장된 경우다 — 투명 앵커나 좌표 클램프로는 막지 못하는, 이 보정이 필요한 진짜 이유다.
   */
  const cases: Array<{
    label: string
    bounds: readonly [number, number, number, number]
    canvas: { width: number; height: number }
    /** 캔버스 안에서 마커가 찍힌 위치 = 프레임 좌표(960,540) - (minX,minY) */
    markerInCanvas: { x: number; y: number }
  }> = [
    {
      label: '마커만 — 캔버스가 내용 크기(40x40)로 작아진다',
      bounds: [940, 520, 980, 560],
      canvas: { width: 40, height: 40 },
      markerInCanvas: { x: 20, y: 20 },
    },
    {
      label: '좌상단으로 삐져나간 freedraw — 원점이 음수로 간다',
      bounds: [-70, -50, 980, 560],
      canvas: { width: 1050, height: 610 },
      markerInCanvas: { x: 1030, y: 590 },
    },
    {
      label: '우하단으로 삐져나간 freedraw — 원점은 그대로, 캔버스만 커진다',
      bounds: [940, 520, 2050, 1180],
      canvas: { width: 1110, height: 660 },
      markerInCanvas: { x: 20, y: 20 },
    },
    {
      label: '양쪽으로 삐져나감 — 캔버스가 프레임보다 커진다',
      bounds: [-70, -50, 2050, 1180],
      canvas: { width: 2120, height: 1230 },
      markerInCanvas: { x: 1030, y: 590 },
    },
  ]

  for (const { label, bounds, canvas, markerInCanvas } of cases) {
    it(`${label} → 마커가 프레임 (960,540)으로 복원된다`, () => {
      const placement = annotationPlacement(bounds, canvas)
      const frame = toFrameCoords(placement, canvas, markerInCanvas)

      expect(frame.x).toBeCloseTo(960, 6)
      expect(frame.y).toBeCloseTo(540, 6)
    })
  }

  it('배치는 픽셀이 아니라 프레임 대비 비율이다 — 강사 창 크기와 합성 캔버스 크기가 다르다', () => {
    const placement = annotationPlacement([960, 540, 1920, 1080], { width: 960, height: 540 })

    expect(placement).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('프레임을 벗어난 내용은 음수 비율로 남긴다 — 잘라내지 않는다(CSS가 클립한다)', () => {
    // 클램프해서 획을 프레임 안으로 순간이동시키면 강사가 그린 자리와 녹화가 달라진다.
    const placement = annotationPlacement([-192, -108, 0, 0], { width: 192, height: 108 })

    expect(placement.x).toBeCloseTo(-0.1, 6)
    expect(placement.y).toBeCloseTo(-0.1, 6)
  })
})

describe('판서 op 적용', () => {
  function docWith(elements: Array<{ id: string; isDeleted?: boolean }>, revision = 1): AnnotationDocument {
    return { revision, elements }
  }

  it('upsert는 같은 id를 덮어쓰고 새 id는 추가한다', () => {
    const start = docWith([{ id: 'a' }, { id: 'b' }])

    const { document } = applyAnnotationOp(start, {
      type: 'upsert',
      revision: 2,
      elements: [{ id: 'b', tag: 'updated' }, { id: 'c' }],
    })

    expect(document.revision).toBe(2)
    expect(document.elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(document.elements.find((e) => e.id === 'b')?.tag).toBe('updated')
  })

  it('delete는 해당 id를 빼고, clear는 전부 비운다', () => {
    const afterDelete = applyAnnotationOp(docWith([{ id: 'a' }, { id: 'b' }]), {
      type: 'delete',
      revision: 2,
      ids: ['a'],
    }).document
    expect(afterDelete.elements.map((e) => e.id)).toEqual(['b'])

    const afterClear = applyAnnotationOp(afterDelete, { type: 'clear', revision: 3 }).document
    expect(afterClear.elements).toEqual([])
    expect(afterClear.revision).toBe(3)
  })

  it('같은 op를 두 번 적용해도 결과가 같다 — 재전송이 판서를 흔들지 않는다', () => {
    const start = docWith([{ id: 'a' }])
    const op: AnnotationOp = { type: 'upsert', revision: 2, elements: [{ id: 'b' }] }

    const once = applyAnnotationOp(start, op).document
    const twice = applyAnnotationOp(once, op).document

    expect(twice).toEqual(once)
  })

  /**
   * 유실을 조용히 넘기면 빠진 획을 모른 채 반쪽짜리 판서가 녹화된다. 그럴 땐 이전 상태를 유지하고
   * 스냅샷을 기다리는 편이 낫다.
   */
  it('revision이 이어지지 않으면 op를 버리고 stale을 세운다', () => {
    const start = docWith([{ id: 'a' }], 5)

    const { document, stale } = applyAnnotationOp(start, {
      type: 'upsert',
      revision: 9,
      elements: [{ id: 'z' }],
    })

    expect(stale).toBe(true)
    expect(document).toEqual(start)
  })

  it('스냅샷은 revision을 건너뛰어도 받아들인다 — 유실 복구의 유일한 경로다', () => {
    const start = docWith([{ id: 'a' }], 5)

    const { document, stale } = applyAnnotationOp(start, {
      type: 'snapshot',
      revision: 42,
      elements: [{ id: 'x' }, { id: 'y' }],
    })

    expect(stale).toBe(false)
    expect(document.revision).toBe(42)
    expect(document.elements.map((e) => e.id)).toEqual(['x', 'y'])
  })

  it('빈 문서는 revision 0에서 시작한다 — 첫 op(revision 1)가 바로 이어진다', () => {
    const { document, stale } = applyAnnotationOp(emptyAnnotationDocument(), {
      type: 'upsert',
      revision: 1,
      elements: [{ id: 'first' }],
    })

    expect(stale).toBe(false)
    expect(document.elements.map((e) => e.id)).toEqual(['first'])
  })

  it('지운 요소는 배열에 남기고 렌더에서만 뺀다 — Excalidraw 되돌리기가 그 표현을 요구한다', () => {
    const document = docWith([{ id: 'a' }, { id: 'gone', isDeleted: true }])

    expect(visibleAnnotationElements(document).map((e) => e.id)).toEqual(['a'])
    expect(document.elements).toHaveLength(2)
  })
})

/**
 * Excalidraw의 `onChange`는 diff가 아니라 매번 전체 배열을 준다. 그대로 실어 보내면 판서가 쌓일수록
 * 획 하나가 수백 KB가 된다 — 이 diff가 없으면 데이터 채널이 문서 크기에 비례해 무거워진다.
 */
describe('판서 diff — 바뀐 요소만 골라낸다', () => {
  it('첫 호출은 모든 요소를 upsert로 낸다', () => {
    const { changes, known } = diffAnnotationElements(new Map(), [
      { id: 'a', version: 1 },
      { id: 'b', version: 1 },
    ])

    expect(changes).toEqual([{ type: 'upsert', elements: [{ id: 'a', version: 1 }, { id: 'b', version: 1 }] }])
    expect(known).toEqual(new Map([['a', 1], ['b', 1]]))
  })

  it('version이 그대로면 아무것도 보내지 않는다', () => {
    const known = new Map([['a', 3], ['b', 7]])

    const result = diffAnnotationElements(known, [{ id: 'a', version: 3 }, { id: 'b', version: 7 }])

    expect(result.changes).toEqual([])
  })

  it('version이 오른 요소만 upsert한다 — 나머지는 내용이 같다', () => {
    const known = new Map([['a', 3], ['b', 7]])

    const { changes } = diffAnnotationElements(known, [
      { id: 'a', version: 3 },
      { id: 'b', version: 8, moved: true },
    ])

    expect(changes).toEqual([{ type: 'upsert', elements: [{ id: 'b', version: 8, moved: true }] }])
  })

  it('사라진 요소는 delete로 낸다', () => {
    const known = new Map([['a', 1], ['gone', 1]])

    const { changes, known: next } = diffAnnotationElements(known, [{ id: 'a', version: 1 }])

    expect(changes).toEqual([{ type: 'delete', ids: ['gone'] }])
    expect(next.has('gone')).toBe(false)
  })

  /**
   * 수신 측은 문서를 다시 편집하지 않으니 되돌리기용 표현(`isDeleted`)을 유지할 이유가 없다.
   * 그대로 보내면 지운 획이 문서에 영원히 쌓여 스냅샷이 계속 커진다.
   */
  it('isDeleted가 붙은 요소는 upsert하지 않고 delete로 바꾼다', () => {
    const known = new Map([['a', 1], ['erased', 1]])

    const { changes } = diffAnnotationElements(known, [
      { id: 'a', version: 1 },
      { id: 'erased', version: 2, isDeleted: true },
    ])

    expect(changes).toEqual([{ type: 'delete', ids: ['erased'] }])
  })

  it('삭제를 upsert보다 먼저 낸다 — 지운 자리에 새 요소가 오는 순서가 뒤집히지 않는다', () => {
    const known = new Map([['old', 1]])

    const { changes } = diffAnnotationElements(known, [{ id: 'new', version: 1 }])

    expect(changes.map((change) => change.type)).toEqual(['delete', 'upsert'])
  })

  it('version이 없는 요소도 다룬다 — 0으로 보고 최초 1회만 보낸다', () => {
    const first = diffAnnotationElements(new Map(), [{ id: 'a' }])
    expect(first.changes).toHaveLength(1)

    const second = diffAnnotationElements(first.known, [{ id: 'a' }])
    expect(second.changes).toEqual([])
  })
})

describe('판서 op 인코딩', () => {
  it('왕복해도 op가 그대로다', () => {
    const op: AnnotationOp = {
      type: 'upsert',
      revision: 7,
      elements: [{ id: 'a', type: 'freedraw', points: [[0, 0], [10, 10]] }],
    }

    expect(decodeAnnotationOp(encodeAnnotationOp(op))).toEqual(op)
  })

  /**
   * 이 디코더는 Egress의 헤드리스 Chrome에서 돈다. 여기서 던진 예외는 녹화 중 화면을 멈출 수 있다 —
   * 판서 한 획을 잃는 것과 강의 녹화가 끊기는 것은 비교할 수 없다.
   */
  it.each([
    ['빈 payload', new Uint8Array()],
    ['JSON이 아닌 바이트', new Uint8Array([0xff, 0xfe, 0x00, 0x01])],
    ['JSON이지만 객체가 아님', new TextEncoder().encode('42')],
    ['봉투 버전이 다름', new TextEncoder().encode(JSON.stringify({ v: 2, op: { type: 'clear', revision: 1 } }))],
    ['op가 없음', new TextEncoder().encode(JSON.stringify({ v: 1 }))],
    ['revision이 숫자가 아님', new TextEncoder().encode(JSON.stringify({ v: 1, op: { type: 'clear', revision: 'x' } }))],
    ['모르는 op type', new TextEncoder().encode(JSON.stringify({ v: 1, op: { type: 'explode', revision: 1 } }))],
    ['upsert인데 elements가 배열이 아님', new TextEncoder().encode(JSON.stringify({ v: 1, op: { type: 'upsert', revision: 1, elements: {} } }))],
    ['delete인데 ids가 없음', new TextEncoder().encode(JSON.stringify({ v: 1, op: { type: 'delete', revision: 1 } }))],
  ])('%s → 예외 없이 null', (_label, payload) => {
    expect(decodeAnnotationOp(payload)).toBeNull()
  })
})
