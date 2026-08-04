import { ANNOTATION_FRAME_HEIGHT, ANNOTATION_FRAME_WIDTH, type AnnotationElement } from './annotation'
import { elementsInCrop, toVideoRect, type CropRect } from './annotationHighlight'
import { loadExcalidraw } from './excalidrawRuntime'

/**
 * 강조 영역 합성 캡처(ADR-0074).
 *
 * <p>영상 프레임을 잘라 깔고 그 위에 판서를 얹어 한 장으로 만든다. <b>영상이 없으면 의미가 없다</b> —
 * 강사가 슬라이드의 한 부분에 동그라미를 쳤을 때, 판서만 렌더하면 빈 화면에 동그라미 하나가 남는다.
 * 그것을 근거로 색인하면 영실이가 읽을 것이 없다.
 *
 * <p>합성은 브라우저에서만 할 수 있다. 영상 프레임은 여기에만 있고, 서버로 보내려면 그 순간의 프레임을
 * 따로 올려야 하는데 그건 같은 일을 두 번 하는 것이다.
 */

/** 출력 이미지의 긴 변 상한. 근거로 읽힐 만큼은 크고, 에셋 한도(5MiB)에는 한참 못 미치게. */
export const HIGHLIGHT_IMAGE_MAX_EDGE = 1600

/**
 * 출력 포맷과 품질.
 *
 * <p><b>PNG를 쓰지 않는다.</b> 이 이미지는 영상 프레임을 자른 것이라 사진에 가깝고, PNG는 사진에
 * 최악의 선택이다(무손실 압축이라 몇 배 커진다). 그리고 이 바이트는 <b>강사의 업링크로 나간다</b> —
 * 라이브 송출과 같은 회선이라 크기가 그대로 영상 품질과 경쟁한다.
 *
 * <p>품질 0.85는 글자가 읽히는 선에서 잡은 값이다. 근거 이미지의 목적이 "모델이 읽는 것"이라
 * 사람 눈보다 글자 가독성이 기준이다.
 */
export const HIGHLIGHT_IMAGE_TYPE = 'image/webp'
export const HIGHLIGHT_IMAGE_QUALITY = 0.85

export interface CaptureSource {
  /** 합성할 영상. LiveKit 로컬 트랙이라 캔버스가 오염되지 않아 `toBlob`이 된다. */
  video: HTMLVideoElement
  /** 판서 문서 전체(강조 획 포함). 이 중 크롭에 걸치는 것만 그린다. */
  elements: readonly AnnotationElement[]
  /** 논리 프레임(1920×1080) 기준 크롭 영역. */
  rect: CropRect
}

/**
 * 크롭 영역을 합성해 PNG로 만든다.
 *
 * @returns 합성 이미지. 영상이 아직 프레임을 갖지 않았으면 null(재생 직후 한두 틱 동안 그렇다).
 */
export async function captureHighlightImage(source: CaptureSource): Promise<Blob | null> {
  const { video, elements, rect } = source
  const videoWidth = video.videoWidth
  const videoHeight = video.videoHeight
  // 트랙이 붙기 전이거나 첫 프레임 전이면 0이다. 그대로 그리면 InvalidStateError가 아니라
  // 조용히 빈 이미지가 나온다 — 여기서 멈추는 편이 낫다.
  if (!videoWidth || !videoHeight) return null

  const videoRect = toVideoRect(rect, { width: videoWidth, height: videoHeight })
  const scale = outputScale(videoRect)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(videoRect.width * scale))
  canvas.height = Math.max(1, Math.round(videoRect.height * scale))

  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(
    video,
    videoRect.x, videoRect.y, videoRect.width, videoRect.height,
    0, 0, canvas.width, canvas.height,
  )

  await drawAnnotations(context, elements, rect, canvas)

  return await toImageBlob(canvas)
}

/**
 * 판서를 크롭 위에 얹는다.
 *
 * <p><b>`exportToCanvas`의 원점은 프레임이 아니라 내용 바운딩 박스다.</b> 그래서 결과 캔버스를 그냥
 * (0,0)에 얹으면 판서가 밀린다 — 강사 화면에서는 정상으로 보이고 잘린 이미지에서만 어긋나는,
 * 판서 합성에서 이미 밟은 함정이다(ADR-0051). 실제 바운딩 박스를 읽어 크롭 원점 기준으로 보정한다.
 */
async function drawAnnotations(
  context: CanvasRenderingContext2D,
  elements: readonly AnnotationElement[],
  rect: CropRect,
  output: { width: number; height: number },
): Promise<void> {
  const visible = elementsInCrop(elements, rect)
  if (visible.length === 0) return

  const { exportToCanvas, getCommonBounds } = await loadExcalidraw()
  const layer = await exportToCanvas({
    elements: visible as never,
    // 배경을 넣지 않는다 — 아래 깔린 영상이 보여야 한다.
    appState: { exportBackground: false } as never,
    files: null,
    exportPadding: 0,
    getDimensions: (width: number, height: number) => ({ width, height, scale: 1 }),
  })

  const [minX, minY] = getCommonBounds(visible as never)
  // 논리 프레임 → 출력 픽셀. 크롭 원점을 빼서 잘린 이미지 안에서의 위치로 옮긴다.
  const scaleX = output.width / rect.width
  const scaleY = output.height / rect.height
  context.drawImage(
    layer,
    (minX - rect.x) * scaleX,
    (minY - rect.y) * scaleY,
    layer.width * scaleX,
    layer.height * scaleY,
  )
}

/** 긴 변을 상한에 맞춘다. 원본이 이미 작으면 늘리지 않는다 — 없는 해상도를 만들어 봐야 소용없다. */
function outputScale(videoRect: CropRect): number {
  const longest = Math.max(videoRect.width, videoRect.height)
  return longest > HIGHLIGHT_IMAGE_MAX_EDGE ? HIGHLIGHT_IMAGE_MAX_EDGE / longest : 1
}

function toImageBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, HIGHLIGHT_IMAGE_TYPE, HIGHLIGHT_IMAGE_QUALITY))
}

/** 논리 프레임 전체를 덮는 크롭. 강조 없이 화면 전체를 잡아야 할 때의 기준값이다. */
export const FULL_FRAME_RECT: CropRect = {
  x: 0,
  y: 0,
  width: ANNOTATION_FRAME_WIDTH,
  height: ANNOTATION_FRAME_HEIGHT,
}
