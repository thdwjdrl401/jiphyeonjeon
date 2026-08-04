import {
  ANNOTATION_FRAME_HEIGHT,
  ANNOTATION_FRAME_WIDTH,
  type AnnotationElement,
} from './annotation'

/**
 * 강조 판서 캡처(ADR-0074).
 *
 * <p>강사가 <b>강조 툴</b>로 화면 일부를 표시하면, 그 순간의 화면(화면공유 우선, 없으면 카메라)과
 * 판서를 합성해 잘라 둔다. 이 이미지가 영실이 근거의 원본이 된다.
 *
 * <p><b>강조 표시를 이미지에서 빼지 않는다.</b> 어디가 강조된 부분인지 모델에 알려 주는 신호이기
 * 때문이다. 기존 판서 해석(ADR-0054)은 정반대로 표시를 빼야 한다 — 거기서는 동그라미가 도형으로
 * 오독된다. <b>두 경로는 별개다.</b>
 */

/** 강조 툴로 그린 요소에 붙는 표식. 일반 판서와 구분하는 유일한 근거다. */
export const HIGHLIGHT_CUSTOM_DATA_KEY = 'liveclassHighlight'

/**
 * 강조 획의 색. 일반 판서와 눈으로 구분돼야 하고, 밝은 슬라이드·어두운 자료 양쪽에서 읽혀야 한다.
 * 반투명이라 아래 내용이 비친다 — 강조는 덮는 것이 아니라 가리키는 것이다.
 */
export const HIGHLIGHT_STROKE_COLOR = '#f59f00'
export const HIGHLIGHT_OPACITY = 60

/**
 * 크롭에 두는 여백(논리 프레임 픽셀).
 *
 * <p>강조 획에 딱 맞춰 자르면 <b>가리킨 대상이 잘린다</b> — 강사는 대개 대상을 감싸거나 밑줄을 긋고,
 * 그 대상은 획 바깥에 있다. 넉넉히 두고 자르는 편이 모델이 읽을 것이 많다.
 */
export const HIGHLIGHT_CROP_PADDING = 96

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** 강조 툴로 그린 요소인가. */
export function isHighlightElement(element: AnnotationElement): boolean {
  const custom = element.customData as Record<string, unknown> | undefined
  return Boolean(custom && custom[HIGHLIGHT_CUSTOM_DATA_KEY] === true)
}

/**
 * 강조 요소들을 감싸는 크롭 영역(논리 프레임 좌표).
 *
 * <p>여백을 더한 뒤 <b>프레임 안으로 자른다.</b> 프레임을 넘긴 사각형을 그대로 쓰면 영상에서 없는
 * 영역을 읽게 되고, `drawImage`가 그 부분을 투명으로 채워 이미지 가장자리에 검은 띠가 남는다.
 *
 * @returns 강조 요소가 없으면 null.
 */
export function highlightCropRect(
  elements: readonly AnnotationElement[],
  padding: number = HIGHLIGHT_CROP_PADDING,
): CropRect | null {
  const boxes = elements.filter(isHighlightElement).map(elementBox).filter((box): box is CropRect => box !== null)
  if (boxes.length === 0) return null

  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.width))
  const maxY = Math.max(...boxes.map((b) => b.y + b.height))

  const left = clamp(minX - padding, 0, ANNOTATION_FRAME_WIDTH)
  const top = clamp(minY - padding, 0, ANNOTATION_FRAME_HEIGHT)
  const right = clamp(maxX + padding, 0, ANNOTATION_FRAME_WIDTH)
  const bottom = clamp(maxY + padding, 0, ANNOTATION_FRAME_HEIGHT)

  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/**
 * 논리 프레임(1920×1080) 좌표를 영상의 실제 픽셀 좌표로 옮긴다.
 *
 * <p><b>여기가 이 기능에서 제일 조용히 틀리는 자리다.</b> 판서는 논리 프레임 기준이고 영상은 자기
 * 해상도를 갖는데(720p·1080p·화면공유 해상도 제각각), 둘을 맞추지 않으면 <b>엉뚱한 영역이 잘린다</b>.
 * 그런데 화면에는 아무 표시가 없고, 영실이가 틀린 근거로 답할 때야 드러난다. 그래서 비율로 옮긴다 —
 * `annotationPlacement`가 합성 화면에서 쓰는 것과 같은 규칙이다.
 */
export function toVideoRect(rect: CropRect, video: { width: number; height: number }): CropRect {
  const scaleX = video.width / ANNOTATION_FRAME_WIDTH
  const scaleY = video.height / ANNOTATION_FRAME_HEIGHT
  return {
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.max(1, Math.round(rect.width * scaleX)),
    height: Math.max(1, Math.round(rect.height * scaleY)),
  }
}

/**
 * 크롭 영역에 걸치는 판서 요소만 남긴다.
 *
 * <p>합성할 때 문서 전체를 렌더하면 크롭 밖 판서까지 그려져 이미지가 어지러워진다. 겹치는 것만
 * 남기되 <b>강조 획은 반드시 포함</b>한다 — 그것이 "여기를 보라"는 신호다.
 */
export function elementsInCrop(
  elements: readonly AnnotationElement[],
  rect: CropRect,
): AnnotationElement[] {
  return elements.filter((element) => {
    if (isHighlightElement(element)) return true
    const box = elementBox(element)
    if (!box) return false
    return box.x < rect.x + rect.width
      && box.x + box.width > rect.x
      && box.y < rect.y + rect.height
      && box.y + box.height > rect.y
  })
}

/**
 * 합성할 영상 트랙을 고른다. <b>화면공유가 있으면 그쪽</b>이다 — 강조 대상은 대개 슬라이드이고,
 * 카메라를 잡으면 강사 얼굴이 근거로 색인된다.
 */
export function pickCompositeTrack<T>(screenShare: T | undefined, camera: T | undefined): T | null {
  return screenShare ?? camera ?? null
}

function elementBox(element: AnnotationElement): CropRect | null {
  const x = numberOf(element.x)
  const y = numberOf(element.y)
  const width = numberOf(element.width)
  const height = numberOf(element.height)
  if (x === null || y === null) return null
  // 음수 크기(오른쪽→왼쪽으로 그린 사각형)를 그대로 두면 겹침 판정이 항상 거짓이 된다.
  const w = width ?? 0
  const h = height ?? 0
  return {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    width: Math.abs(w),
    height: Math.abs(h),
  }
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
