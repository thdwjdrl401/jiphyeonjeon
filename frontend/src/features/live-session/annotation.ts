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
 * 레이저 포인터 전용 topic. 판서 op와 <b>같은 채널에 섞지 않는다.</b>
 *
 * <p>레이저는 성격이 정반대다 — 초당 수십 건이고, 1초면 사라지며, 유실돼도 무해하다. op 스트림에
 * 태우면 `revision`이 폭증하고(유실 감지가 의미를 잃는다) 신뢰성 전송의 재전송 비용만 든다.
 * 그래서 별도 topic에 <b>lossy</b>로 보낸다.
 */
export const ANNOTATION_LASER_TOPIC = 'annotation-laser'

/**
 * 레이저 잔상 감쇠 시간(ms). Excalidraw의 `DECAY_TIME`과 같은 값이어야 강사·수강생 화면이 같아진다
 * (excalidraw `laser-trails.ts`의 `getTrailOptions`).
 */
export const LASER_DECAY_TIME = 1000

/**
 * 머리로부터 이 개수만큼 떨어진 점부터 가늘어진다. Excalidraw의 `DECAY_LENGTH`와 같은 값.
 */
export const LASER_DECAY_LENGTH = 50

/** Excalidraw가 레이저에 쓰는 색(`DEFAULT_LASER_COLOR`). */
export const LASER_COLOR = 'red'

/**
 * 레이저 외곽선을 Excalidraw와 <b>같은 모양의</b> path로 만든다(`getSvgPathFromStroke`).
 *
 * <p>Excalidraw는 외곽선 점을 직선으로 잇지 않는다. 각 변의 <b>중점</b>을 지나는 2차 곡선(`Q`·`T`)으로
 * 이어 모서리를 깎는다. 직선으로 이으면 같은 점을 써도 획이 조금 더 두껍고 <b>끝이 조금 더 뻗는다</b> —
 * 눈에는 레이저가 강사가 가리킨 곳에서 살짝 밀린 것으로 읽힌다. 강사 화면은 Excalidraw가, 수강생
 * 화면은 우리가 그리므로 이 차이가 그대로 두 화면의 차이가 된다.
 *
 * <p>점이 4개 미만이면 빈 문자열이다 — Excalidraw도 그때는 아무것도 그리지 않는다.
 */
export function laserOutlinePath(outline: readonly (readonly number[])[]): string {
  const length = outline.length
  if (length < 4) return ''

  const mid = (a: number, b: number) => ((a + b) / 2).toFixed(2)
  const first = outline[0]
  const second = outline[1]
  const third = outline[2]

  let path = `M${first[0].toFixed(2)},${first[1].toFixed(2)}`
    + ` Q${second[0].toFixed(2)},${second[1].toFixed(2)}`
    + ` ${mid(second[0], third[0])},${mid(second[1], third[1])} T`
  for (let i = 2; i < length - 1; i += 1) {
    const current = outline[i]
    const next = outline[i + 1]
    path += `${mid(current[0], next[0])},${mid(current[1], next[1])} `
  }
  return `${path}Z`
}

/**
 * Excalidraw가 `LaserPointer`에 넘기는 옵션 그대로. 강사 화면은 Excalidraw가 그리고 수강생 화면은
 * 우리가 그리므로, <b>같은 라이브러리에 같은 옵션</b>을 주어야 두 화면이 같아진다.
 *
 * <p>`sizeMapping`은 나이와 머리로부터의 거리 둘 다로 굵기를 줄인다. `pressure` 자리에는 압력이
 * 아니라 <b>점이 찍힌 시각</b>이 들어간다 — Excalidraw가 `addPoint([x, y, performance.now()])`로
 * 그렇게 쓰기 때문이다.
 */
export function laserTrailOptions(now: () => number) {
  const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
  return {
    simplify: 0,
    streamline: 0.4,
    sizeMapping: (c: { pressure: number; totalLength: number; currentIndex: number }) => {
      const age = Math.max(0, 1 - (now() - c.pressure) / LASER_DECAY_TIME)
      const tail = (LASER_DECAY_LENGTH - Math.min(LASER_DECAY_LENGTH, c.totalLength - c.currentIndex))
        / LASER_DECAY_LENGTH
      return Math.min(easeOut(tail), easeOut(age))
    },
  }
}

/**
 * 레이저 궤적 한 조각. 프레임 좌표(1920x1080)와 강사 기준 시각을 함께 싣는다.
 *
 * <p>시각을 싣는 이유는 잔상 소멸 때문만이 아니다. 나중에 "강사가 어디에 머물렀나"(dwell)를 뽑아
 * 강조 지점으로 쓰려면 시간축이 필요하다 — 지금 저장하지 않더라도 그 선택지를 닫지 않는다.
 */
export interface LaserPoint {
  x: number
  y: number
  /** 강사 브라우저 기준 단조 시각(ms). 절대 시각이 아니라 잔상 계산용 상대값이다. */
  t: number
}

/**
 * 레이저 한 획의 경계. <b>포인터를 누르고 있는 동안만</b> 궤적이 존재한다 — Excalidraw가 그렇게
 * 동작한다(`button === "down"`일 때만 `startPath`/`addPointToPath`). 그냥 마우스를 움직이는 것으로는
 * 아무것도 그려지지 않는다.
 */
export interface LaserStroke {
  phase: 'start' | 'move' | 'end'
  points: LaserPoint[]
  /**
   * 획을 그릴 때 강사 화면의 zoom. <b>굵기를 맞추는 데 쓴다.</b>
   *
   * <p>Excalidraw는 외곽선을 `size / zoom` scene 단위로 만든 뒤 viewport로 변환한다(`× zoom`) —
   * 결과가 zoom과 무관하게 늘 화면 2px이다. 수신 측이 이 보정을 빼면 `2 × zoom`px이 되어, 강사 창이
   * 작을수록(zoom이 작을수록) 수강생 화면의 궤적이 가늘어진다. Egress는 강사의 zoom을 알 수 없으므로
   * 획에 실어 보낸다.
   */
  zoom: number
}

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
  /**
   * Excalidraw의 fractional index. <b>z-order의 정본</b>이다(사전식으로 비교한다).
   *
   * <p>op에는 순서 정보가 없어 수신 측은 도착 순으로 배열을 재구성한다. 그러면 나중에 온 요소가 항상
   * 맨 위가 되어, 강사 화면에서 아래에 깔린 화이트보드가 수강생 화면에서는 판서를 덮는다. 렌더 직전에
   * 이 값으로 정렬해야 양쪽이 같아진다({@link visibleAnnotationElements}).
   */
  index?: string
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
  /**
   * 이미지 요소가 참조하는 파일들(`fileId` → 내용).
   *
   * <p>Excalidraw는 이미지 요소에 데이터를 담지 않고 `fileId`로 <b>가리키기만</b> 한다. 그래서
   * 요소만 보내면 수신 측에는 빈 자리가 남는다 — 강사 화면에는 보이는데 수강생 화면에는 없는,
   * 이 프로젝트에서 반복해 겪은 그 어긋남이다.
   *
   * <p>수식(ADR-0054)이 이 경로를 쓴다. 분수·적분의 상하 구조는 글자로 표현할 수 없어 렌더한
   * SVG를 이미지로 넣는데, 그 SVG가 여기 실려야 수강생에게도 같은 것이 보인다.
   */
  files: AnnotationFiles
}

/** `fileId` → Excalidraw가 이해하는 파일 한 벌. 내용은 data URI다(외부 요청이 없어야 한다). */
export type AnnotationFiles = Record<string, {
  id: string
  mimeType: string
  dataURL: string
  created: number
  [key: string]: unknown
}>

/**
 * 판서 변경 op. 데이터 채널로 흐르는 단위다.
 *
 * <p>`snapshot`은 전체 상태를 담아 그것만으로 문서를 복원한다. Egress가 강의 도중 재접속하면
 * 그 전에 흐른 op를 받을 방법이 없으므로, 스냅샷이 유실 복구의 유일한 경로다.
 */
export type AnnotationOp =
  | { type: 'snapshot'; revision: number; elements: AnnotationElement[]; files?: AnnotationFiles }
  | { type: 'upsert'; revision: number; elements: AnnotationElement[]; files?: AnnotationFiles }
  | { type: 'delete'; revision: number; ids: string[] }
  | { type: 'clear'; revision: number }
  /**
   * "여기까지의 전체 상태는 서버에 있다"(ADR-0055).
   *
   * <p>스냅샷을 대신한다. 스냅샷은 문서 전체라 판서가 길어지면 데이터 채널의 64KB 한도를 넘고
   * (실측 74.9KB) 넘는 순간 통째로 실패해 <b>수강생 화면에 판서가 아예 나오지 않는다</b>. 포인터는
   * 수십 바이트라 그런 일이 없다.
   *
   * <p>수신 측은 이걸 받으면 §3-6d의 `GET`으로 문서를 가져오고, 버퍼에 쌓아 둔 op 중
   * `revision > N`인 것만 얹는다.
   */
  | { type: 'pointer'; revision: number }

/**
 * 강사가 내는 변경. `revision`은 전송 계층이 붙인다 — 강사가 단일 writer이므로 번호를 매기는 곳이
 * 하나뿐이어야 하고, 화면 코드가 그것까지 관리하면 어긋날 여지가 생긴다.
 */
export type AnnotationChange = Omit<Extract<AnnotationOp, { type: 'snapshot' }>, 'revision'>
  | Omit<Extract<AnnotationOp, { type: 'upsert' }>, 'revision'>
  | Omit<Extract<AnnotationOp, { type: 'delete' }>, 'revision'>
  | Omit<Extract<AnnotationOp, { type: 'clear' }>, 'revision'>
  | Omit<Extract<AnnotationOp, { type: 'pointer' }>, 'revision'>

/** 아직 아무것도 그리지 않은 상태. */
export function emptyAnnotationDocument(): AnnotationDocument {
  return { revision: 0, elements: [], files: {} }
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
    // 스냅샷은 전체 상태다. 파일도 그 시점의 전부로 갈아 끼운다.
    return {
      document: { revision: op.revision, elements: [...op.elements], files: { ...op.files } },
      stale: false,
    }
  }

  // 포인터는 문서를 바꾸지 않는다 — "서버에 있다"는 안내일 뿐이고, 실제 적용은 가져온 뒤에 한다.
  // 여기서 revision을 올려 버리면 그 사이 흐른 op가 "이미 본 것"으로 버려진다.
  if (op.type === 'pointer') return { document, stale: false }

  // 이미 본 op의 재전송이면 무시한다. 같은 op를 두 번 적용해도 결과가 같아야 한다(멱등).
  if (op.revision <= document.revision) return { document, stale: false }
  // 중간이 빠졌다. 지금 상태를 유지한 채 스냅샷을 기다린다.
  if (op.revision > document.revision + 1) return { document, stale: true }

  switch (op.type) {
    case 'upsert': {
      const byId = new Map(document.elements.map((element) => [element.id, element]))
      for (const element of op.elements) byId.set(element.id, element)
      // 파일은 <b>더한다</b>. upsert는 부분 변경이라 이번에 안 실린 파일은 그대로 살아 있어야 한다 —
      // 갈아 끼우면 앞서 넣은 수식이 빈 자리가 된다.
      return {
        document: {
          revision: op.revision,
          elements: [...byId.values()],
          files: { ...document.files, ...op.files },
        },
        stale: false,
      }
    }
    case 'delete': {
      const removed = new Set(op.ids)
      return {
        document: {
          revision: op.revision,
          elements: document.elements.filter((element) => !removed.has(element.id)),
          // 파일은 지우지 않는다. 되돌리기로 요소가 돌아올 수 있고, 그때 파일이 없으면 빈 자리가 된다.
          files: document.files,
        },
        stale: false,
      }
    }
    case 'clear':
      return { document: { revision: op.revision, elements: [], files: document.files }, stale: false }
  }
}

/**
 * 화면에 실제로 그려지는 요소만, <b>z-order대로</b>.
 *
 * <p>두 가지를 한다. 지운 요소를 빼고(Excalidraw는 배열에 남겨 둔다), `index`(fractional index)로
 * 정렬한다.
 *
 * <p><b>정렬이 없으면 강사와 수강생 화면이 갈린다.</b> op에는 순서 정보가 없어 수신 측은 도착 순으로
 * 배열을 재구성한다({@link applyAnnotationOp}의 `upsert`는 Map 병합이라 새 id가 맨 뒤에 붙는다).
 * 그래서 강사가 화이트보드를 판서 <b>아래</b>에 깔아도 수강생 화면에서는 나중에 도착한 화이트보드가
 * 맨 위로 올라와 판서를 덮는다. 속성 패널의 Layers(앞으로/뒤로)도 같은 이유로 수강생에게만 안 먹는다.
 *
 * <p>`index`는 사전식으로 비교하는 문자열이다. <b>모든 요소가 index를 가질 때만</b> 정렬한다 —
 * 일부만 가진 상태에서 섞어 비교하면 "A는 B보다 앞, B는 C보다 앞, 그런데 A와 C는 도착 순"처럼
 * 추이적이지 않은 비교가 되어 정렬 결과를 예측할 수 없다. 하나라도 없으면 도착 순을 그대로 둔다.
 *
 * <p>실제로는 Excalidraw가 씬을 갱신할 때 index를 채워 주므로 publish되는 요소는 모두 index를 갖는다.
 * 이 분기는 옛 op나 손으로 만든 요소를 위한 방어다.
 */
/**
 * 강사 에디터에 넣을 순서. <b>화이트보드는 언제나 맨 아래다.</b>
 *
 * <p>Excalidraw는 배열 순서를 z-order로 쓴다(앞이 뒤쪽 레이어). 서버에서 복원한 순서는 그리기
 * 순서라 화이트보드가 맨 앞이라는 보장이 없고, 그대로 넣으면 판이 판서를 덮는다 — 강사는
 * 화이트보드를 껐다 켜야 판서를 다시 본다.
 *
 * <p>수신 측은 {@link visibleAnnotationElements}가 같은 일을 한다. 그쪽에만 있어서 <b>같은 문서가
 * 두 화면에서 다르게 그려지고</b> 있었다 — 강사 화면 = 수강생 화면을 깨는 자리다.
 */
export function orderedForScene(elements: readonly AnnotationElement[]): AnnotationElement[] {
  const board = elements.filter((element) => element.id === WHITEBOARD_ELEMENT_ID)
  if (board.length === 0) return [...elements]
  return [...board, ...elements.filter((element) => element.id !== WHITEBOARD_ELEMENT_ID)]
}

export function visibleAnnotationElements(document: AnnotationDocument): AnnotationElement[] {
  const visible = document.elements.filter((element) => element.isDeleted !== true)

  // 화이트보드는 정의상 <b>배경</b>이라 언제나 맨 아래다. 우리가 손으로 만든 요소라 index가 없을 수
  // 있어 아래 정렬에서 빠질 수 있는데, 그러면 나중에 도착한 판이 판서를 덮는다. 규칙으로 못박는다.
  const board = visible.filter((element) => element.id === WHITEBOARD_ELEMENT_ID)
  const rest = visible.filter((element) => element.id !== WHITEBOARD_ELEMENT_ID)

  if (!rest.every((element) => typeof element.index === 'string')) return [...board, ...rest]
  const ordered = [...rest].sort((a, b) => (a.index! < b.index! ? -1 : a.index! > b.index! ? 1 : 0))
  return [...board, ...ordered]
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
 * 화이트보드 요소의 고정 id. 토글을 여러 번 눌러도 하나만 존재하게 하고, 지울 때 이 id로 찾는다.
 */
export const WHITEBOARD_ELEMENT_ID = 'liveclass-whiteboard'

/**
 * 프레임 전체를 덮는 불투명 판. 화면공유 없이 판서만 할 때 쓴다.
 *
 * <p><b>왜 배경색이 아니라 요소인가.</b> Excalidraw의 `viewBackgroundColor`는 요소가 아니라 appState라
 * 데이터 채널로 흐르지 않는다. 그것을 쓰려면 op에 필드를 더하고 Egress 렌더에도 분기를 넣어야 한다.
 * 반면 요소로 두면 <b>기존 upsert/delete/스냅샷 경로를 그대로 타고</b> Egress는 아무 변경 없이 그린다.
 *
 * <p>맨 뒤에 놓고 `locked`로 잠근다 — 잠그지 않으면 강사가 판서를 하려다 판을 선택해 끌어버린다.
 */
export function whiteboardElement(color = '#ffffff'): AnnotationElement {
  return {
    id: WHITEBOARD_ELEMENT_ID,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: ANNOTATION_FRAME_WIDTH,
    height: ANNOTATION_FRAME_HEIGHT,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: color,
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    // 손그림 질감을 끈다. 판 테두리가 삐뚤면 화면 경계가 지저분해진다.
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: true,
  }
}

/**
 * 강사 에디터의 zoom. 이 값이 논리 프레임을 강사 컨테이너에 매핑한다.
 *
 * <p><b>왜 zoom인가.</b> Excalidraw의 scene 좌표 단위는 `zoom: 1`일 때 컨테이너의 CSS 픽셀이다.
 * 에디터를 컨테이너에 그대로 채우면 <b>문서 좌표가 강사 창 크기에 종속</b>된다 — 창이 1000px일 때
 * 화면 중앙에 그은 획이 `(500, 281)`로 기록되고, Egress는 그것을 `500/1920 = 26%` 지점에 그린다.
 * 창 크기를 바꾸면 판서가 영상 위에서 통째로 어긋난다.
 *
 * <p>대신 `zoom = 컨테이너폭 / 1920`, `scroll = 0`으로 두면 Excalidraw의 좌표 변환
 * (`viewport = (scene + scroll) * zoom`)에 따라 scene `(1920, 1080)`이 컨테이너 우하단에 정확히
 * 맞는다. scene 좌표가 곧 논리 프레임 좌표가 되어 창 크기·전체화면과 무관해진다.
 *
 * <p>CSS `transform: scale()`로 고정 1920x1080 박스를 축소하는 방법을 먼저 시도했지만 <b>동작하지
 * 않는다</b>. Excalidraw가 `getBoundingClientRect()`로 컨테이너를 재는데 그 값은 transform이 적용된
 * 크기여서, 에디터가 자기 viewport를 축소된 크기로 잡고 거기에 배율이 한 번 더 걸린다(실측: 무대
 * 960x540인데 캔버스가 480x270).
 *
 * <p>컨테이너가 16:9가 아닐 수도 있으므로 짧은 축을 기준으로 삼는다 — 넘치는 쪽이 잘려 강사가
 * 실제로 나가지 않는 영역에 그리는 일을 막는다.
 */
export function annotationStageScale(container: { width: number; height: number }): number {
  if (!(container.width > 0) || !(container.height > 0)) return 0
  return Math.min(container.width / ANNOTATION_FRAME_WIDTH, container.height / ANNOTATION_FRAME_HEIGHT)
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
 * 강사 화면의 포인터 위치를 논리 프레임 좌표로 옮긴다.
 *
 * <p>에디터는 `zoom = 컨테이너폭 / 1920`, `scroll = 0`으로 프레임을 컨테이너에 맞춘다
 * ({@link annotationStageScale}). 그 역이 곧 이 변환이다 — 컨테이너 안 거리(px)를 zoom으로 나누면
 * 프레임 좌표가 된다.
 *
 * <p>이게 틀리면 <b>학생 화면에서 레이저가 엉뚱한 곳을 가리킨다</b>. 강사는 자기 커서를 보므로
 * 어긋남이 드러나지 않는다.
 */
export function laserPointFromPointer(
  pointer: { clientX: number; clientY: number },
  container: { left: number; top: number; width: number; height: number },
  at: number,
): LaserPoint | null {
  const zoom = annotationStageScale(container)
  if (zoom <= 0) return null
  return {
    x: (pointer.clientX - container.left) / zoom,
    y: (pointer.clientY - container.top) / zoom,
    t: at,
  }
}

/** 레이저 궤적 payload. op와 형식을 나눠 서로를 오해석하지 않게 한다. */
export function encodeLaserStroke(stroke: LaserStroke): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({ v: 1, laser: { phase: stroke.phase, points: stroke.points, zoom: stroke.zoom } }),
  ) as Uint8Array<ArrayBuffer>
}

/**
 * 레이저 payload를 되돌린다. 해석할 수 없으면 `null`이다 — Egress에서 예외가 나면 녹화가 멈춘다.
 */
export function decodeLaserStroke(payload: Uint8Array): LaserStroke | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as { v?: unknown; laser?: unknown }
    if (!parsed || parsed.v !== 1 || !parsed.laser || typeof parsed.laser !== 'object') return null
    const laser = parsed.laser as { phase?: unknown; points?: unknown; zoom?: unknown }
    if (laser.phase !== 'start' && laser.phase !== 'move' && laser.phase !== 'end') return null
    if (!Array.isArray(laser.points)) return null
    // zoom이 없거나 이상하면 1로 본다 — 굵기만 어긋나고 궤적은 그대로 보이는 편이 낫다.
    const zoom = typeof laser.zoom === 'number' && laser.zoom > 0 ? laser.zoom : 1
    const points = (laser.points as unknown[]).filter((point): point is LaserPoint => {
      if (!point || typeof point !== 'object') return false
      const p = point as Partial<LaserPoint>
      return [p.x, p.y, p.t].every((value) => typeof value === 'number' && Number.isFinite(value))
    })
    return { phase: laser.phase, points, zoom }
  } catch {
    return null
  }
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
      case 'pointer':
        return op
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * 주어진 요소들이 실제로 가리키는 파일만 골라낸다.
 *
 * <p>전부 실으면 획 하나를 그을 때마다 판서에 있는 모든 수식 SVG가 데이터 채널과 DB로 다시 나간다.
 * 수식 하나가 6KB대이므로 몇 개만 쌓여도 획마다 수십 KB가 붙는다.
 */
export function referencedFiles(
  elements: readonly AnnotationElement[],
  files: AnnotationFiles,
): AnnotationFiles {
  const picked: AnnotationFiles = {}
  for (const element of elements) {
    const fileId = element.fileId
    if (typeof fileId === 'string' && files[fileId]) picked[fileId] = files[fileId]
  }
  return picked
}

/**
 * op에 실을 좌표의 소수 자릿수.
 *
 * <p>Excalidraw가 주는 좌표는 소수점 15자리다 — `-0.66668701171875` 같은 값이 그대로 실린다.
 * 1920x1080 프레임에서 그 끝자리는 <b>0.0007픽셀</b> 차이라 눈으로도 렌더링으로도 구분되지 않는데,
 * 점 하나에 40자를 쓴다.
 *
 * <p>2자리면 최대 오차가 <b>0.005px</b>다. 획 굵기(2px)의 1/400이고, 우리 판서는 확대가 없어
 * (zoom = 컨테이너폭 / 1920 고정, §3-6b) 들여다볼 방법도 없다. 4K 전체화면에서 2배로 봐도
 * 0.01 화면px이다.
 *
 * <p>더 줄여도(1자리) 절감은 2%밖에 늘지 않는다 — 실측 기준 29% vs 31%. 오차만 10배가 되므로
 * 2자리가 분명한 지점이다.
 */
const COORDINATE_DECIMALS = 2

function round(value: number): number {
  const scale = 10 ** COORDINATE_DECIMALS
  return Math.round(value * scale) / scale
}

/**
 * op에 실을 요소에서 <b>의미 없는 좌표 정밀도를 덜어낸다</b>.
 *
 * <p>스냅샷은 문서 전체라 판서가 길어질수록 커지는데, 실측에서 요소 53개가 66.5KB였고 그중
 * <b>75%가 획의 점</b>이었다. WebRTC 데이터 채널의 기본 최대 메시지는 64KB이고 넘으면 스냅샷이
 * 통째로 실패해 <b>수강생 화면에 판서가 아예 나오지 않는다</b>(§3-6b).
 *
 * <p><b>강사의 문서는 건드리지 않는다.</b> 나가는 사본만 다듬는다 — 에디터가 들고 있는 값을 바꾸면
 * `version` 기반 diff가 그것을 "바뀐 요소"로 보고 다시 내보낸다.
 *
 * <p>각도(`angle`)는 손대지 않는다. 라디안이라 2자리면 0.57도가 어긋나 회전한 글자가 눈에 띄게
 * 틀어진다 — 좌표와 달리 이건 보인다.
 */
export function trimAnnotationPrecision(element: AnnotationElement): AnnotationElement {
  const trimmed: AnnotationElement = { ...element }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = element[key]
    if (typeof value === 'number') trimmed[key] = round(value)
  }
  if (Array.isArray(element.points)) {
    trimmed.points = (element.points as unknown[]).map((point) =>
      Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number'
        ? [round(point[0]), round(point[1])]
        : point)
  }
  return trimmed
}

/** op 하나에 실린 요소 전부를 다듬는다. 요소가 없는 op(`delete`·`clear`)는 그대로 둔다. */
export function trimOpPrecision(op: AnnotationOp): AnnotationOp {
  if (op.type !== 'snapshot' && op.type !== 'upsert') return op
  return { ...op, elements: op.elements.map(trimAnnotationPrecision) }
}
