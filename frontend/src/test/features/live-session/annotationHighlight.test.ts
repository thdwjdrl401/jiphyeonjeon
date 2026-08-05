import { describe, expect, it } from 'vitest'
import { ANNOTATION_FRAME_HEIGHT, ANNOTATION_FRAME_WIDTH, type AnnotationElement } from '@/features/live-session/annotation'
import {
  HIGHLIGHT_CUSTOM_DATA_KEY,
  hasHighlight,
  isHighlightElement,
  pickCompositeTrack,
  videoContainRect,
} from '@/features/live-session/annotationHighlight'

/**
 * 강조 판서 캡처의 배치 계산(ADR-0074, ADR-0079로 개정).
 *
 * <p>여기를 테스트로 묶는 이유는 이 계산이 <b>조용히 틀리기 때문</b>이다. 배치가 어긋나도 화면에는
 * 아무 표시가 없고, 엉뚱한 그림이 AI로 넘어간 뒤 영실이가 틀린 근거로 답할 때야 드러난다.
 * 같은 종류의 함정을 판서 합성에서 이미 밟았다(강사 화면에서는 정상, 녹화에서만 어긋남 — ADR-0051).
 *
 * <p>예전에는 크롭 사각형을 영상 원본 좌표로 되돌리는 <b>역변환</b>을 여기서 검증했다. 그 역변환이
 * 레터박스를 몰라서 운영에서 어긋났고(ADR-0079), 지금은 자르지 않으므로 역변환 자체가 없다.
 * 남은 것은 강사 화면·Egress와 같은 정방향 배치 하나뿐이다.
 */

function element(overrides: Partial<AnnotationElement> = {}): AnnotationElement {
  return { id: crypto.randomUUID(), x: 0, y: 0, width: 10, height: 10, ...overrides }
}

function highlight(overrides: Partial<AnnotationElement> = {}): AnnotationElement {
  return element({ customData: { [HIGHLIGHT_CUSTOM_DATA_KEY]: true }, ...overrides })
}

describe('강조 요소 판별', () => {
  it('강조 툴 표식이 있는 요소만 강조다', () => {
    expect(isHighlightElement(highlight())).toBe(true)
    expect(isHighlightElement(element())).toBe(false)
    // 다른 customData(수식 LaTeX 원문 등)가 붙어 있어도 강조가 아니다.
    expect(isHighlightElement(element({ customData: { liveclassMathLatex: 'y=x' } }))).toBe(false)
  })

  it('강조가 하나도 없으면 남길 것이 없다', () => {
    expect(hasHighlight([element(), element()])).toBe(false)
    expect(hasHighlight([element(), highlight()])).toBe(true)
  })
})

describe('영상 배치(contain)', () => {
  it('16:9는 프레임을 꽉 채운다 — 여백이 없다', () => {
    expect(videoContainRect({ width: 1280, height: 720 }))
      .toEqual({ x: 0, y: 0, width: ANNOTATION_FRAME_WIDTH, height: ANNOTATION_FRAME_HEIGHT })
  })

  /**
   * 16:10 노트북 화면공유. 예전 크롭 경로는 영상이 프레임을 꽉 채운다고 보고 비례 변환해서,
   * 강사가 그린 자리와 실제로 잘리는 자리가 갈렸다.
   */
  it('세로가 긴 화면은 좌우에 여백을 두고 가운데 놓는다', () => {
    const rect = videoContainRect({ width: 1920, height: 1200 })
    expect(rect).toEqual({ x: 96, y: 0, width: 1728, height: ANNOTATION_FRAME_HEIGHT })
    // 좌우 여백이 같아야 가운데다 — 한쪽으로 쏠리면 판서가 통째로 밀린다.
    expect(rect!.x).toBe(ANNOTATION_FRAME_WIDTH - (rect!.x + rect!.width))
  })

  it('가로가 긴 화면은 위아래에 여백을 두고 가운데 놓는다', () => {
    const rect = videoContainRect({ width: 3440, height: 1440 })
    expect(rect!.width).toBe(ANNOTATION_FRAME_WIDTH)
    expect(rect!.height).toBeCloseTo(ANNOTATION_FRAME_WIDTH * 1440 / 3440, 6)
    expect(rect!.y).toBeCloseTo((ANNOTATION_FRAME_HEIGHT - rect!.height) / 2, 6)
  })

  it('프레임보다 작은 영상도 늘려서 채운다 — 배치 규칙은 해상도와 무관하다', () => {
    expect(videoContainRect({ width: 640, height: 360 }))
      .toEqual({ x: 0, y: 0, width: ANNOTATION_FRAME_WIDTH, height: ANNOTATION_FRAME_HEIGHT })
  })

  /** 트랙이 붙기 전이거나 첫 프레임 전이면 0이다. 그대로 그리면 조용히 빈 이미지가 나온다. */
  it('아직 프레임이 없으면 배치할 수 없다', () => {
    expect(videoContainRect({ width: 0, height: 0 })).toBeNull()
    expect(videoContainRect({ width: 1920, height: 0 })).toBeNull()
  })
})

describe('합성할 트랙 선택', () => {
  it('화면공유가 있으면 화면공유다 — 강조 대상은 대개 슬라이드다', () => {
    expect(pickCompositeTrack('screen', 'camera')).toBe('screen')
  })

  it('화면공유가 없으면 카메라로 떨어진다', () => {
    expect(pickCompositeTrack(undefined, 'camera')).toBe('camera')
  })

  it('둘 다 없으면 캡처할 화면이 없다', () => {
    expect(pickCompositeTrack(undefined, undefined)).toBeNull()
  })
})
