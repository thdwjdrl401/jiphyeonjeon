import { describe, expect, it } from 'vitest'
import { ANNOTATION_FRAME_HEIGHT, ANNOTATION_FRAME_WIDTH, type AnnotationElement } from '@/features/live-session/annotation'
import {
  HIGHLIGHT_CUSTOM_DATA_KEY,
  elementsInCrop,
  highlightCropRect,
  isHighlightElement,
  pickCompositeTrack,
  toVideoRect,
} from '@/features/live-session/annotationHighlight'

/**
 * 강조 판서 캡처의 좌표 계산(ADR-0074).
 *
 * <p>여기를 테스트로 묶는 이유는 이 계산이 <b>조용히 틀리기 때문</b>이다. 크롭이 어긋나도 화면에는
 * 아무 표시가 없고, 엉뚱한 영역이 잘려 AI로 넘어간 뒤 영실이가 틀린 근거로 답할 때야 드러난다.
 * 같은 종류의 함정을 판서 합성에서 이미 밟았다(강사 화면에서는 정상, 녹화에서만 어긋남 — ADR-0051).
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
})

describe('크롭 영역', () => {
  it('강조가 없으면 자를 것이 없다', () => {
    expect(highlightCropRect([element(), element()])).toBeNull()
  })

  it('강조 획들을 모두 감싸고 여백을 더한다', () => {
    const rect = highlightCropRect(
      [highlight({ x: 500, y: 400, width: 100, height: 50 }), highlight({ x: 700, y: 300, width: 40, height: 40 })],
      100,
    )
    // 합친 bbox는 (500,300)~(740,450). 여기에 여백 100.
    expect(rect).toEqual({ x: 400, y: 200, width: 440, height: 350 })
  })

  it('일반 판서는 크롭 영역을 넓히지 않는다', () => {
    const withOther = highlightCropRect(
      [highlight({ x: 500, y: 400, width: 100, height: 50 }), element({ x: 0, y: 0, width: 100, height: 100 })],
      100,
    )
    const alone = highlightCropRect([highlight({ x: 500, y: 400, width: 100, height: 50 })], 100)
    expect(withOther).toEqual(alone)
  })

  /**
   * 프레임을 넘긴 사각형을 그대로 쓰면 영상에 없는 영역을 읽고, `drawImage`가 그 부분을 투명으로
   * 채워 이미지 가장자리에 검은 띠가 남는다.
   */
  it('여백이 프레임을 넘어가면 프레임 안으로 자른다', () => {
    const rect = highlightCropRect([highlight({ x: 10, y: 10, width: 20, height: 20 })], 100)
    expect(rect).toEqual({ x: 0, y: 0, width: 130, height: 130 })

    const bottomRight = highlightCropRect(
      [highlight({ x: ANNOTATION_FRAME_WIDTH - 20, y: ANNOTATION_FRAME_HEIGHT - 20, width: 20, height: 20 })],
      100,
    )
    expect(bottomRight!.x + bottomRight!.width).toBe(ANNOTATION_FRAME_WIDTH)
    expect(bottomRight!.y + bottomRight!.height).toBe(ANNOTATION_FRAME_HEIGHT)
  })

  /** 오른쪽→왼쪽으로 그린 도형은 width가 음수다. 그대로 두면 겹침 판정이 항상 거짓이 된다. */
  it('음수 크기로 그린 획도 제대로 감싼다', () => {
    const rect = highlightCropRect([highlight({ x: 600, y: 500, width: -100, height: -50 })], 0)
    expect(rect).toEqual({ x: 500, y: 450, width: 100, height: 50 })
  })
})

describe('영상 픽셀 좌표 변환', () => {
  it('논리 프레임과 해상도가 같으면 그대로다', () => {
    const rect = { x: 480, y: 270, width: 960, height: 540 }
    expect(toVideoRect(rect, { width: ANNOTATION_FRAME_WIDTH, height: ANNOTATION_FRAME_HEIGHT })).toEqual(rect)
  })

  /**
   * 720p 화면공유에서 1920 기준 좌표를 그대로 쓰면 화면 <b>바깥</b>을 읽는다. 실제로는 아무 오류도
   * 나지 않고 빈 이미지가 근거로 색인된다.
   */
  it('해상도가 다르면 비율로 옮긴다', () => {
    expect(toVideoRect({ x: 960, y: 540, width: 480, height: 270 }, { width: 1280, height: 720 }))
      .toEqual({ x: 640, y: 360, width: 320, height: 180 })
  })

  it('아주 작은 영역도 최소 1픽셀은 남는다', () => {
    const tiny = toVideoRect({ x: 0, y: 0, width: 1, height: 1 }, { width: 320, height: 180 })
    expect(tiny.width).toBeGreaterThanOrEqual(1)
    expect(tiny.height).toBeGreaterThanOrEqual(1)
  })
})

describe('크롭에 담을 판서', () => {
  const rect = { x: 500, y: 500, width: 200, height: 200 }

  it('겹치는 판서만 담는다', () => {
    const inside = element({ x: 550, y: 550, width: 10, height: 10 })
    const overlapping = element({ x: 480, y: 480, width: 40, height: 40 })
    const outside = element({ x: 0, y: 0, width: 10, height: 10 })
    expect(elementsInCrop([inside, overlapping, outside], rect)).toEqual([inside, overlapping])
  })

  it('강조 획은 영역 밖이어도 반드시 담는다', () => {
    const far = highlight({ x: 0, y: 0, width: 10, height: 10 })
    expect(elementsInCrop([far], rect)).toEqual([far])
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
