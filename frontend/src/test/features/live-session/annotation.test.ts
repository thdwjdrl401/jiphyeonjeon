import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_FRAME_HEIGHT,
  ANNOTATION_FRAME_WIDTH,
  annotationPlacement,
  annotationStageScale,
  decodeLaserStroke,
  encodeLaserStroke,
  laserOutlinePath,
  laserPointFromPointer,
  applyAnnotationOp,
  decodeAnnotationOp,
  diffAnnotationElements,
  emptyAnnotationDocument,
  encodeAnnotationOp,
  visibleAnnotationElements,
  WHITEBOARD_ELEMENT_ID,
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

/**
 * 강사 에디터는 고정 1920x1080 박스 안에서 살고, 그 박스를 배율로 축소해 보여준다.
 *
 * 이 배율을 쓰지 않고 에디터를 컨테이너에 그대로 채우면 문서 좌표가 <b>강사 창 크기에 종속</b>된다 —
 * 창이 1000px일 때 중앙에 그은 획이 (500,281)로 기록되고 Egress는 26% 지점에 그린다. 창 크기를
 * 바꾸면 판서가 영상 위에서 통째로 어긋난다. 실제로 그렇게 배포한 적이 있다.
 */
describe('판서 무대 배율', () => {
  it('컨테이너 폭이 프레임 폭의 절반이면 배율도 절반이다', () => {
    expect(annotationStageScale({ width: 960, height: 540 })).toBeCloseTo(0.5, 6)
  })

  it('창 크기가 달라져도 같은 scene 좌표가 화면에서 같은 비율 위치를 가리킨다', () => {
    // scene (960, 540) = 프레임 중앙. 어떤 컨테이너에서도 화면 중앙이어야 한다.
    for (const container of [
      { width: 1920, height: 1080 },
      { width: 1000, height: 562.5 },
      { width: 640, height: 360 },
      { width: 3840, height: 2160 },
    ]) {
      const scale = annotationStageScale(container)
      expect((960 * scale) / container.width).toBeCloseTo(0.5, 6)
      expect((540 * scale) / container.height).toBeCloseTo(0.5, 6)
    }
  })

  it('16:9가 아닌 컨테이너에서는 짧은 축을 따른다 — 나가지 않는 영역에 그리지 않게 한다', () => {
    // 세로가 부족한 경우: 높이 기준
    expect(annotationStageScale({ width: 1920, height: 540 })).toBeCloseTo(0.5, 6)
    // 가로가 부족한 경우: 폭 기준
    expect(annotationStageScale({ width: 960, height: 1080 })).toBeCloseTo(0.5, 6)
  })

  it('크기를 아직 모르면 0이다 — 첫 렌더에서 잘못된 배율로 그리지 않는다', () => {
    expect(annotationStageScale({ width: 0, height: 0 })).toBe(0)
    expect(annotationStageScale({ width: 100, height: 0 })).toBe(0)
  })
})

/**
 * 레이저는 요소가 아니라 사라지는 궤적이라 op 파이프라인에 잡히지 않는다. 별도 topic으로 좌표만
 * 흘려보내고 수신 측이 잔상을 그린다.
 */
describe('레이저 포인터', () => {
  it('포인터 위치를 프레임 좌표로 옮긴다 — 컨테이너 크기와 무관하게 같은 지점', () => {
    // 컨테이너가 절반 크기든 4배든, 화면 중앙은 프레임 (960, 540)이다.
    for (const container of [
      { left: 0, top: 0, width: 1920, height: 1080 },
      { left: 100, top: 50, width: 960, height: 540 },
      { left: 0, top: 0, width: 3840, height: 2160 },
    ]) {
      const point = laserPointFromPointer(
        { clientX: container.left + container.width / 2, clientY: container.top + container.height / 2 },
        container,
        1000,
      )
      expect(point!.x).toBeCloseTo(960, 6)
      expect(point!.y).toBeCloseTo(540, 6)
    }
  })

  it('컨테이너 크기를 모르면 좌표를 만들지 않는다', () => {
    expect(laserPointFromPointer({ clientX: 10, clientY: 10 }, { left: 0, top: 0, width: 0, height: 0 }, 1)).toBeNull()
  })

  /**
   * Excalidraw는 <b>포인터를 누르고 있는 동안만</b> 궤적을 만든다(`button === "down"`).
   * 그냥 마우스를 움직일 때도 보내면 강사 화면에는 아무것도 없는데 수강생 화면에만 궤적이 생긴다.
   */
  it('획 경계를 함께 싣는다 — 누른 순간·이동·뗀 순간', () => {
    for (const phase of ['start', 'move', 'end'] as const) {
      const stroke = { phase, points: [{ x: 1, y: 2, t: 3 }], zoom: 0.5 }
      expect(decodeLaserStroke(encodeLaserStroke(stroke))).toEqual(stroke)
    }
  })

  it('뗀 순간에는 점이 없어도 된다 — 획을 닫는 신호다', () => {
    const stroke = { phase: 'end' as const, points: [], zoom: 1 }
    expect(decodeLaserStroke(encodeLaserStroke(stroke))).toEqual(stroke)
  })

  /** Egress에서 예외가 나면 녹화 중 화면이 멈춘다 — 어떤 payload도 예외로 번지지 않게 한다. */
  it.each([
    ['빈 payload', new Uint8Array()],
    ['JSON 아님', new Uint8Array([0xff, 0x00])],
    ['봉투 버전 다름', new TextEncoder().encode(JSON.stringify({ v: 2, laser: { phase: 'move', points: [] } }))],
    ['phase 없음', new TextEncoder().encode(JSON.stringify({ v: 1, laser: { points: [] } }))],
    ['모르는 phase', new TextEncoder().encode(JSON.stringify({ v: 1, laser: { phase: 'zap', points: [] } }))],
    ['points가 배열 아님', new TextEncoder().encode(JSON.stringify({ v: 1, laser: { phase: 'move', points: {} } }))],
    ['판서 op를 잘못 넣음', new TextEncoder().encode(JSON.stringify({ v: 1, op: { type: 'clear', revision: 1 } }))],
  ])('%s → 예외 없이 null', (_label, payload) => {
    expect(decodeLaserStroke(payload)).toBeNull()
  })

  /**
   * Excalidraw는 외곽선을 `size / zoom`으로 만든 뒤 viewport로 변환해(× zoom) 늘 화면 2px을 낸다.
   * 수신 측이 zoom을 모르면 이 보정을 못 해 `2 × zoom`px이 되고, 강사 창이 작을수록 수강생 화면의
   * 궤적이 가늘어진다.
   */
  it('굵기 보정용 zoom을 함께 싣는다', () => {
    const stroke = { phase: 'move' as const, points: [{ x: 1, y: 2, t: 3 }], zoom: 0.25 }
    expect(decodeLaserStroke(encodeLaserStroke(stroke))?.zoom).toBe(0.25)
  })

  it('zoom이 없거나 이상하면 1로 본다 — 굵기만 어긋나고 궤적은 그대로 보인다', () => {
    for (const bad of [undefined, 0, -1, 'x']) {
      const payload = new TextEncoder().encode(JSON.stringify({
        v: 1, laser: { phase: 'move', points: [], zoom: bad },
      }))
      expect(decodeLaserStroke(payload)?.zoom).toBe(1)
    }
  })

  it('좌표가 숫자가 아닌 점은 버린다', () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      v: 1, laser: { phase: 'move', points: [{ x: 1, y: 2, t: 3 }, { x: 'a', y: 2, t: 3 }, { x: 4, y: 5 }] },
    }))
    expect(decodeLaserStroke(payload)).toEqual({ phase: 'move', points: [{ x: 1, y: 2, t: 3 }], zoom: 1 })
  })

  /**
   * 강사 화면은 Excalidraw가, 수강생 화면은 우리가 그린다. Excalidraw는 외곽선 점을 직선으로 잇지
   * 않고 각 변의 <b>중점</b>을 지나는 2차 곡선으로 이으므로(`getSvgPathFromStroke`), 직선으로 이으면
   * 같은 점을 써도 획이 조금 더 두껍고 끝이 더 뻗는다 — 레이저가 살짝 밀려 보인다.
   */
  describe('외곽선 path — Excalidraw와 같은 곡선으로 잇는다', () => {
    it('첫 점에서 시작해 중점을 지나는 곡선으로 잇고 닫는다', () => {
      expect(laserOutlinePath([[0, 0], [10, 0], [10, 10], [0, 10]]))
        .toBe('M0.00,0.00 Q10.00,0.00 10.00,5.00 T5.00,10.00 Z')
    })

    it('마지막 점도 중점 계산에 쓴다 — 빼면 끝이 짧아진다', () => {
      const path = laserOutlinePath([[0, 0], [2, 0], [4, 0], [6, 0], [8, 0]])

      // 마지막 두 점 (6,0)·(8,0)의 중점
      expect(path).toContain('7.00,0.00')
    })

    /** Excalidraw도 점이 4개 미만이면 아무것도 그리지 않는다. 우리만 그리면 없어야 할 점이 남는다. */
    it('점이 4개 미만이면 아무것도 그리지 않는다', () => {
      expect(laserOutlinePath([])).toBe('')
      expect(laserOutlinePath([[0, 0], [1, 1], [2, 2]])).toBe('')
    })
  })
})

describe('판서 op 적용', () => {
  function docWith(elements: Array<{ id: string; isDeleted?: boolean }>, revision = 1): AnnotationDocument {
    return { revision, elements, files: {} }
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

  /**
   * 강사가 새로고침하면 revision 카운터가 0부터 다시 시작하는데 Egress의 문서 revision은 살아 있다.
   * 그 상태에서 새로 그린 획은 전부 "이미 본 op"로 버려져 <b>수강생에게 영영 나타나지 않는다</b> —
   * 강사 화면에는 그려지므로 눈치채기 어렵다.
   *
   * 빈 스냅샷이 유일한 탈출구다. `snapshot`은 revision 검사를 건너뛰므로 반드시 적용되고, 그 값으로
   * revision이 내려앉아 이후 낮은 번호의 op가 정상 처리된다.
   */
  it('새로고침으로 revision이 역행해도 빈 스냅샷으로 복구된다', () => {
    // Egress는 이미 47까지 진행한 상태.
    let doc: AnnotationDocument = { revision: 47, elements: [{ id: 'old' }], files: {} }

    // 새로고침 직후의 획들 — revision이 1부터라 전부 버려진다.
    for (const revision of [1, 2, 3]) {
      const result = applyAnnotationOp(doc, { type: 'upsert', revision, elements: [{ id: `new-${revision}` }] })
      doc = result.document
    }
    expect(doc.elements.map((e) => e.id)).toEqual(['old'])
    expect(doc.revision).toBe(47)

    // 접속 시 보내는 빈 스냅샷이 문서와 revision을 강사의 실제 상태로 되돌린다.
    doc = applyAnnotationOp(doc, { type: 'snapshot', revision: 1, elements: [] }).document
    expect(doc.elements).toEqual([])
    expect(doc.revision).toBe(1)

    // 이제 낮은 번호의 op가 정상 적용된다.
    doc = applyAnnotationOp(doc, { type: 'upsert', revision: 2, elements: [{ id: 'after-reload' }] }).document
    expect(doc.elements.map((e) => e.id)).toEqual(['after-reload'])
  })

  it('clear로는 복구되지 않는다 — revision 검사를 받아 똑같이 버려진다', () => {
    const doc: AnnotationDocument = { revision: 47, elements: [{ id: 'old' }], files: {} }

    const { document } = applyAnnotationOp(doc, { type: 'clear', revision: 1 })

    expect(document.elements.map((e) => e.id)).toEqual(['old'])
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

  /**
   * op에는 순서 정보가 없어 수신 측은 도착 순으로 배열을 재구성한다(`upsert`는 Map 병합이라 새 id가
   * 맨 뒤 = 맨 위층). 그래서 강사가 화이트보드를 판서 <b>아래</b>에 깔아도 수강생 화면에서는 나중에
   * 도착한 화이트보드가 판서를 덮었다. 렌더 직전에 `index`로 정렬해야 양쪽이 같아진다.
   */
  it('z-order를 index로 복원한다 — 나중에 온 화이트보드가 판서를 덮지 않는다', () => {
    // 도착 순: 판서가 먼저, 화이트보드가 나중. 하지만 index는 화이트보드가 더 아래(a0 < a1).
    const document: AnnotationDocument = {
      revision: 2,
      files: {},
      elements: [
        { id: 'stroke', index: 'a1' },
        { id: 'whiteboard', index: 'a0' },
      ],
    }

    expect(visibleAnnotationElements(document).map((e) => e.id)).toEqual(['whiteboard', 'stroke'])
  })

  it('index가 없는 요소는 들어온 순서를 지킨다', () => {
    const document: AnnotationDocument = {
      revision: 1,
      files: {},
      elements: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
    }

    expect(visibleAnnotationElements(document).map((e) => e.id)).toEqual(['first', 'second', 'third'])
  })

  /**
   * 일부만 index를 가진 상태에서 섞어 비교하면 추이적이지 않은 비교가 되어 정렬 결과를 예측할 수 없다.
   * 그럴 때는 손대지 않는 편이 낫다 — 예측 가능한 쪽이 디버깅할 수 있다.
   */
  /**
   * 화이트보드는 우리가 손으로 만든 요소라 index가 없다. index 정렬에만 기대면 정렬에서 빠져
   * 도착 순(맨 뒤 = 맨 위)에 남아 판서를 덮는다 — 실제로 보고된 증상이다.
   */
  it('화이트보드는 index와 무관하게 언제나 맨 아래다', () => {
    const document: AnnotationDocument = {
      revision: 3,
      files: {},
      elements: [
        { id: 'stroke-1', index: 'a1' },
        { id: WHITEBOARD_ELEMENT_ID },
        { id: 'stroke-2', index: 'a2' },
      ],
    }

    expect(visibleAnnotationElements(document).map((e) => e.id))
      .toEqual([WHITEBOARD_ELEMENT_ID, 'stroke-1', 'stroke-2'])
  })

  it('index가 하나라도 없으면 정렬하지 않고 도착 순을 지킨다', () => {
    const document: AnnotationDocument = {
      revision: 1,
      files: {},
      elements: [{ id: 'a', index: 'a2' }, { id: 'no-index' }, { id: 'b', index: 'a1' }],
    }

    expect(visibleAnnotationElements(document).map((e) => e.id)).toEqual(['a', 'no-index', 'b'])
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
