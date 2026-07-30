/**
 * 강사 판서(annotation). 강사 화면과 Egress 합성 화면이 공유하는 계약이다(ADR-0051).
 *
 * <p>판서 문서의 정본 포맷은 <b>Excalidraw 요소 배열</b>이다. 손그림을 AI로 인식해 실제 도형으로
 * 바꿀 때 결과가 이미지가 아니라 <b>다시 편집·리사이즈할 수 있는 객체</b>여야 하는데, Excalidraw
 * 요소로 두면 그 편집 기능이 그대로 따라온다.
 *
 * <p><b>수강생은 이 코드를 받지 않는다.</b> ADR-0032에 따라 수강생은 LiveKit을 직접 구독하지 않고
 * Egress 합성 결과만 본다. 즉 판서가 수강생에게 도달하는 경로는 Egress 프레임 하나뿐이고,
 * Excalidraw 번들(+309KB gzip)은 강사 화면과 Egress 페이지만 지불한다.
 *
 * <p>이 파일에는 <b>Excalidraw를 import하지 않는다.</b> 배치 계산과 op 병합은 순수 함수로 두어
 * 무거운 번들 없이 테스트할 수 있게 한다 — 아래 좌표 계산이 틀리면 강사 화면에서는 정상으로 보이고
 * 녹화와 수강생 화면에서만 판서가 어긋나므로, 눈으로는 잡을 수 없고 테스트로만 잡힌다.
 */

/** 합성 프레임 크기. 판서 좌표가 사는 논리 좌표계다(ADR-0048의 1920x1080 합성 캔버스와 같다). */
export const ANNOTATION_FRAME_WIDTH = 1920
export const ANNOTATION_FRAME_HEIGHT = 1080

/** LiveKit 데이터 채널 topic. 다른 기능이 같은 채널을 쓰더라도 섞이지 않게 한다. */
export const ANNOTATION_TOPIC = 'annotation'

/**
 * 판서 요소. Excalidraw 요소 JSON을 그대로 싣는다.
 *
 * <p>우리가 직접 다루는 필드만 좁게 선언하고 나머지는 통과시킨다. Excalidraw의 내부 타입 경로는
 * 버전마다 움직이는데, 여기서 그 경로에 의존하면 업그레이드가 이 파일의 컴파일을 깨뜨린다.
 */
export interface AnnotationElement {
  id: string
  /**
   * Excalidraw가 요소를 고칠 때마다 올리는 번호. 무엇이 바뀌었는지 알아내는 근거다
   * ({@link diffAnnotationElements}).
   */
  version?: number
  /** 지운 요소도 남긴다 — Excalidraw가 되돌리기(undo)를 위해 요구하는 표현이다. */
  isDeleted?: boolean
  [key: string]: unknown
}

/**
 * 판서 문서. 강사가 단일 writer이므로 CRDT가 필요 없고, 단조 증가하는 `revision` 하나로 족하다.
 */
export interface AnnotationDocument {
  /** 강사가 op를 낼 때마다 1씩 오른다. 수신 측이 유실을 알아채는 유일한 근거다. */
  revision: number
  elements: AnnotationElement[]
}

/**
 * 판서 변경 op. 데이터 채널로 흐르는 단위다.
 *
 * <p>`snapshot`은 전체 상태를 담아 그것만으로 문서를 복원한다. Egress가 강의 도중 재접속하면
 * 그 전에 흐른 op를 받을 방법이 없으므로, 스냅샷이 유실 복구의 유일한 경로다.
 */
export type AnnotationOp =
  | { type: 'snapshot'; revision: number; elements: AnnotationElement[] }
  | { type: 'upsert'; revision: number; elements: AnnotationElement[] }
  | { type: 'delete'; revision: number; ids: string[] }
  | { type: 'clear'; revision: number }

/**
 * 강사가 내는 변경. `revision`은 전송 계층이 붙인다 — 강사가 단일 writer이므로 번호를 매기는 곳이
 * 하나뿐이어야 하고, 화면 코드가 그것까지 관리하면 어긋날 여지가 생긴다.
 */
export type AnnotationChange = Omit<Extract<AnnotationOp, { type: 'snapshot' }>, 'revision'>
  | Omit<Extract<AnnotationOp, { type: 'upsert' }>, 'revision'>
  | Omit<Extract<AnnotationOp, { type: 'delete' }>, 'revision'>
  | Omit<Extract<AnnotationOp, { type: 'clear' }>, 'revision'>

/** 아직 아무것도 그리지 않은 상태. */
export function emptyAnnotationDocument(): AnnotationDocument {
  return { revision: 0, elements: [] }
}

/**
 * Excalidraw가 준 전체 요소 배열에서 <b>바뀐 것만</b> 골라낸다.
 *
 * <p><b>왜 필요한가.</b> Excalidraw의 `onChange`는 diff가 아니라 <b>매번 전체 배열</b>을 준다. 그대로
 * 데이터 채널에 실으면 획 하나를 그을 때마다 문서 전체가 나간다 — 판서가 쌓일수록 메시지가 커져
 * 나중에는 획 하나가 수백 KB가 된다. Excalidraw는 요소를 고칠 때마다 `version`을 올리므로, 그
 * 번호만 비교하면 무엇이 바뀐지 알 수 있다(협업 구현이 쓰는 방식과 같다).
 *
 * <p>지운 요소는 배열에서 사라지지 않고 `isDeleted`가 붙는다. 하지만 수신 측은 문서를 다시 편집하지
 * 않으니 되돌리기용 표현을 유지할 이유가 없다 — `delete`로 보내 아예 빼서 문서를 작게 유지한다.
 *
 * @param known 지금까지 보낸 요소의 `id → version`. 이 함수가 갱신해서 돌려준다.
 * @returns 보낼 변경 목록. 바뀐 것이 없으면 빈 배열이다(그때는 아무것도 보내지 않는다).
 */
export function diffAnnotationElements(
  known: Map<string, number>,
  next: readonly AnnotationElement[],
): { changes: AnnotationChange[]; known: Map<string, number> } {
  const updated = new Map<string, number>()
  const upserts: AnnotationElement[] = []

  for (const element of next) {
    if (element.isDeleted === true) continue
    const version = typeof element.version === 'number' ? element.version : 0
    updated.set(element.id, version)
    // 새 요소이거나 번호가 오른 요소만. 번호가 같으면 내용도 같다.
    if (known.get(element.id) !== version) upserts.push(element)
  }

  const deletedIds = [...known.keys()].filter((id) => !updated.has(id))

  const changes: AnnotationChange[] = []
  if (deletedIds.length > 0) changes.push({ type: 'delete', ids: deletedIds })
  if (upserts.length > 0) changes.push({ type: 'upsert', elements: upserts })

  return { changes, known: updated }
}

/**
 * op를 문서에 적용한다.
 *
 * <p><b>유실을 조용히 넘기지 않는다.</b> 데이터 채널은 publisher 단위로 순서가 보장되지만 재접속을
 * 건너뛰며 유실될 수 있다. revision이 이어지지 않으면 그 op를 버리고 `stale`을 세워 다음 스냅샷을
 * 기다린다 — 빠진 획을 모른 채 반쪽짜리 판서를 녹화하는 것보다, 스냅샷까지 이전 상태를 유지하는 편이
 * 낫다. 스냅샷은 revision과 무관하게 항상 받아들인다(그게 복구 경로다).
 */
export function applyAnnotationOp(
  document: AnnotationDocument,
  op: AnnotationOp,
): { document: AnnotationDocument; stale: boolean } {
  if (op.type === 'snapshot') {
    return { document: { revision: op.revision, elements: [...op.elements] }, stale: false }
  }

  // 이미 본 op의 재전송이면 무시한다. 같은 op를 두 번 적용해도 결과가 같아야 한다(멱등).
  if (op.revision <= document.revision) return { document, stale: false }
  // 중간이 빠졌다. 지금 상태를 유지한 채 스냅샷을 기다린다.
  if (op.revision > document.revision + 1) return { document, stale: true }

  switch (op.type) {
    case 'upsert': {
      const byId = new Map(document.elements.map((element) => [element.id, element]))
      for (const element of op.elements) byId.set(element.id, element)
      return { document: { revision: op.revision, elements: [...byId.values()] }, stale: false }
    }
    case 'delete': {
      const removed = new Set(op.ids)
      return {
        document: {
          revision: op.revision,
          elements: document.elements.filter((element) => !removed.has(element.id)),
        },
        stale: false,
      }
    }
    case 'clear':
      return { document: { revision: op.revision, elements: [] }, stale: false }
  }
}

/** 화면에 실제로 그려지는 요소만. Excalidraw는 지운 요소를 배열에 남겨 둔다. */
export function visibleAnnotationElements(document: AnnotationDocument): AnnotationElement[] {
  return document.elements.filter((element) => element.isDeleted !== true)
}

/**
 * `exportToCanvas`가 만든 캔버스를 합성 프레임의 어디에 얹을지.
 *
 * <p><b>왜 보정이 필요한가.</b> `exportToCanvas`는 프레임이 아니라 <b>내용 바운딩 박스</b>를 기준으로
 * 그린다 — 내용을 `-minX, -minY`만큼 평행이동시키고 캔버스 크기도 내용 크기로 잡는다. 그래서 획을
 * 하나 더 그을 때마다 원점이 움직이고, 그대로 얹으면 기존 판서가 영상 대비 밀린다.
 *
 * <p><b>왜 앵커나 클램프가 아닌가.</b> 프레임 전체를 덮는 투명 요소로 바운딩 박스를 고정하는 방법은
 * `freedraw`에서 깨진다. 선언된 `x/y/width/height`가 프레임 안이어도 `points`는 그 bbox를 넘어갈 수
 * 있고, 바운딩 박스는 선언값이 아니라 실제 geometry로 계산된다(ADR-0051 실측). 좌표를 클램프해도
 * 같은 이유로 막지 못한다. 그래서 막으려 하지 않고 <b>실제 오프셋을 읽어 보정한다</b>.
 *
 * @param bounds Excalidraw `getCommonBounds()` 결과 `[minX, minY, maxX, maxY]`.
 * @param canvas `exportToCanvas()`가 돌려준 캔버스의 픽셀 크기.
 * @returns 합성 프레임에 대한 비율(0~1). 프레임과 캔버스는 크기가 다르므로(브라우저 창 vs 1920x1080)
 *          픽셀이 아니라 비율로 얹는다 — `cameraOverlay`와 같은 이유다.
 */
export function annotationPlacement(
  bounds: readonly [number, number, number, number],
  canvas: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const [minX, minY] = bounds
  return {
    x: minX / ANNOTATION_FRAME_WIDTH,
    y: minY / ANNOTATION_FRAME_HEIGHT,
    w: canvas.width / ANNOTATION_FRAME_WIDTH,
    h: canvas.height / ANNOTATION_FRAME_HEIGHT,
  }
}

/**
 * 판서 op를 데이터 채널 payload로 만든다.
 *
 * <p>topic으로 이미 걸러지지만 payload에도 형식을 남긴다 — 다른 기능이 topic을 재사용하거나 옛
 * Egress 페이지가 새 op를 받는 상황에서, 모양이 다른 메시지를 조용히 판서로 해석하면 안 된다.
 *
 * <p>반환 타입을 `Uint8Array<ArrayBuffer>`로 좁힌다. `TextEncoder`의 선언은 `ArrayBufferLike`(공유
 * 버퍼 가능)로 넓은데 LiveKit의 `publishData`는 `ArrayBuffer` 기반만 받는다. 실제로 `TextEncoder`는
 * 언제나 새 `ArrayBuffer`를 만들므로 좁히는 것이 안전하다.
 */
export function encodeAnnotationOp(op: AnnotationOp): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ v: 1, op })) as Uint8Array<ArrayBuffer>
}

/**
 * payload를 op로 되돌린다. 해석할 수 없으면 `null`이다.
 *
 * <p><b>어떤 payload도 예외로 번지지 않게 한다.</b> 이 함수는 Egress의 헤드리스 Chrome에서 돌고,
 * 여기서 던진 예외는 녹화 중 화면을 멈출 수 있다. 판서 한 획을 잃는 것과 강의 녹화가 끊기는 것은
 * 비교할 수 없다.
 */
export function decodeAnnotationOp(payload: Uint8Array): AnnotationOp | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const envelope = parsed as { v?: unknown; op?: unknown }
    if (envelope.v !== 1) return null
    const op = envelope.op as AnnotationOp | undefined
    if (!op || typeof op !== 'object') return null
    if (typeof op.revision !== 'number' || !Number.isFinite(op.revision)) return null

    switch (op.type) {
      case 'snapshot':
      case 'upsert':
        return Array.isArray(op.elements) ? op : null
      case 'delete':
        return Array.isArray(op.ids) ? op : null
      case 'clear':
        return op
      default:
        return null
    }
  } catch {
    return null
  }
}
