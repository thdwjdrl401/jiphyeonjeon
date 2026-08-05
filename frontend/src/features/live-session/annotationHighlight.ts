import {
  ANNOTATION_FRAME_HEIGHT,
  ANNOTATION_FRAME_WIDTH,
  type AnnotationElement,
} from './annotation'

/**
 * 강조 판서 캡처(ADR-0074, ADR-0079로 개정).
 *
 * <p>강사가 <b>강조 툴</b>로 화면 일부를 표시하면, 그 순간의 화면(화면공유 우선, 없으면 카메라)과
 * 판서를 합성해 남긴다. 이 이미지가 영실이 근거의 원본이 된다.
 *
 * <p><b>자르지 않는다(ADR-0079).</b> 예전에는 강조 획 둘레만 잘라 보냈는데, 그러려면 "논리 프레임
 * 좌표 → 영상 원본 좌표"라는 역변환이 필요했고 그 역변환이 조용히 틀렸다. 운영에서 강조 획이 크롭
 * 귀퉁이에 잘린 채 박히고 나머지는 엉뚱한 영역인 이미지가 색인됐다(설명 텍스트 2~3자). 프레임 전체를
 * 보내면 역변환 자체가 없어지고, 모델이 받는 그림이 <b>수강생이 실제로 본 화면</b>과 같아진다.
 *
 * <p><b>강조 표시를 이미지에서 빼지 않는다.</b> 어디가 강조된 부분인지 모델에 알려 주는 신호이기
 * 때문이다 — 자르지 않는 지금은 <b>유일한</b> 신호라 더 그렇다. 기존 판서 해석(ADR-0054)은 정반대로
 * 표시를 빼야 한다(거기서는 동그라미가 도형으로 오독된다). <b>두 경로는 별개다.</b>
 */

/** 강조 툴로 그린 요소에 붙는 표식. 일반 판서와 구분하는 유일한 근거다. */
export const HIGHLIGHT_CUSTOM_DATA_KEY = 'liveclassHighlight'

/**
 * 강조 획의 색. 일반 판서(빨강 `#e03131`)와 눈으로 구분돼야 하고, 밝은 슬라이드·어두운 자료 양쪽에서
 * 읽혀야 한다. 반투명이라 아래 내용이 비친다 — 강조는 덮는 것이 아니라 가리키는 것이다.
 *
 * <p><b>비전 프롬프트가 이 값을 그대로 말한다.</b> 자르지 않으므로 모델은 색으로만 강조를 찾는다.
 * 여기를 바꾸면 {@code AnnotationHighlightDescriber}의 프롬프트도 함께 바꿔야 한다.
 */
export const HIGHLIGHT_STROKE_COLOR = '#f59f00'
export const HIGHLIGHT_OPACITY = 60

export interface FrameRect {
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

/** 남길 강조가 문서에 있는가. 없으면 캡처할 것이 없다. */
export function hasHighlight(elements: readonly AnnotationElement[]): boolean {
  return elements.some(isHighlightElement)
}

/**
 * 영상이 논리 프레임(1920×1080) 안에서 실제로 그려지는 자리.
 *
 * <p><b>늘리지 않고 넣는다(contain).</b> 강사 화면도 Egress 템플릿도 같은 규칙이라(`object-fit:
 * contain`), 셋이 같은 사각형을 그려야 강사가 본 자리와 수강생이 본 자리와 근거 이미지가 일치한다.
 * 16:9가 아닌 화면공유에서는 여백이 남는데, 그 여백은 <b>수강생도 검게 본다</b> — 그래서 근거
 * 이미지도 검게 채운다.
 *
 * <p>예전 크롭 경로는 영상이 프레임을 꽉 채운다고 보고 비례 변환했다. 16:9가 아닌 화면공유에서
 * 강사가 그린 자리와 잘리는 자리가 갈렸고, 화면에는 아무 표시가 없어 영실이가 틀린 근거로 답할 때야
 * 드러났다. 지금은 그 역변환이 없다 — 이 함수 하나가 정방향으로만 쓰인다.
 *
 * @returns 아직 프레임이 없으면(트랙 부착 직후 한두 틱) null.
 */
export function videoContainRect(video: { width: number; height: number }): FrameRect | null {
  if (!(video.width > 0) || !(video.height > 0)) return null
  const scale = Math.min(ANNOTATION_FRAME_WIDTH / video.width, ANNOTATION_FRAME_HEIGHT / video.height)
  const width = video.width * scale
  const height = video.height * scale
  return {
    x: (ANNOTATION_FRAME_WIDTH - width) / 2,
    y: (ANNOTATION_FRAME_HEIGHT - height) / 2,
    width,
    height,
  }
}

/**
 * 합성할 영상 트랙을 고른다. <b>화면공유가 있으면 그쪽</b>이다 — 강조 대상은 대개 슬라이드이고,
 * 카메라를 잡으면 강사 얼굴이 근거로 색인된다.
 */
export function pickCompositeTrack<T>(screenShare: T | undefined, camera: T | undefined): T | null {
  return screenShare ?? camera ?? null
}
