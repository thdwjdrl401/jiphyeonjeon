import { ANNOTATION_FRAME_HEIGHT, ANNOTATION_FRAME_WIDTH, type AnnotationElement } from './annotation'
import { videoContainRect } from './annotationHighlight'
import { loadExcalidraw } from './excalidrawRuntime'

/**
 * 강조 판서 합성 캡처(ADR-0074, ADR-0079로 개정).
 *
 * <p>합성 프레임 한 장을 그대로 만든다 — 영상을 논리 프레임에 contain으로 깔고 그 위에 판서를 얹는다.
 * <b>영상이 없으면 의미가 없다</b> — 강사가 슬라이드의 한 부분에 동그라미를 쳤을 때, 판서만 렌더하면
 * 빈 화면에 동그라미 하나가 남는다. 그것을 근거로 색인하면 영실이가 읽을 것이 없다.
 *
 * <p><b>자르지 않는다.</b> 예전에는 강조 획 둘레만 잘랐는데, 크롭 사각형을 영상 원본 좌표로 되돌리는
 * 계산이 조용히 틀려 엉뚱한 영역이 색인됐다(ADR-0079). 지금은 강사 화면·Egress 템플릿과 같은
 * 정방향 배치 하나만 쓴다. 어디가 강조인지는 <b>색</b>으로 알린다(비전 프롬프트가 색을 말한다).
 *
 * <p>합성은 브라우저에서만 할 수 있다. 영상 프레임은 여기에만 있고, 서버로 보내려면 그 순간의 프레임을
 * 따로 올려야 하는데 그건 같은 일을 두 번 하는 것이다.
 */

/**
 * 레터박스 색. <b>수강생이 실제로 받는 여백 그대로다</b>(`.instructor-media-canvas`·Egress 캔버스와
 * 같은 검정). 투명으로 두면 webp 알파에 남아 모델이 받는 그림이 강사·수강생이 본 것과 달라진다.
 */
const LETTERBOX_COLOR = '#000'

/**
 * 출력 포맷과 품질.
 *
 * <p><b>PNG를 쓰지 않는다.</b> 이 이미지는 영상 프레임이라 사진에 가깝고, PNG는 사진에 최악의
 * 선택이다(무손실이라 몇 배 커진다). 그리고 이 바이트는 <b>강사의 업링크로 나간다</b> — 라이브 송출과
 * 같은 회선이라 크기가 그대로 영상 품질과 경쟁한다.
 *
 * <p>품질 0.85는 글자가 읽히는 선에서 잡은 값이다. 근거 이미지의 목적이 "모델이 읽는 것"이라
 * 사람 눈보다 글자 가독성이 기준이다.
 */
export const HIGHLIGHT_IMAGE_TYPE = 'image/webp'
export const HIGHLIGHT_IMAGE_QUALITY = 0.85

export interface CaptureSource {
  /** 합성할 영상. LiveKit 로컬 트랙이라 캔버스가 오염되지 않아 `toBlob`이 된다. */
  video: HTMLVideoElement
  /** 판서 문서 전체(강조 획 포함). 화면에 있는 그대로 얹는다. */
  elements: readonly AnnotationElement[]
}

/**
 * 합성 프레임 한 장을 만든다.
 *
 * <p>크기는 논리 프레임 그대로(1920×1080)다. <b>따로 줄이지 않는다</b> — 모델이 어차피 자기 한도로
 * 줄이는데 우리가 먼저 줄이면 작은 글자만 두 번 뭉갠다. 자르지 않게 되면서 한 화면에 담기는 글자가
 * 작아졌으므로 남은 해상도를 버릴 이유가 없다.
 *
 * @returns 합성 이미지. 영상이 아직 프레임을 갖지 않았으면 null(재생 직후 한두 틱 동안 그렇다).
 */
export async function captureHighlightImage(source: CaptureSource): Promise<Blob | null> {
  const { video, elements } = source
  // 트랙이 붙기 전이거나 첫 프레임 전이면 0이다. 그대로 그리면 InvalidStateError가 아니라
  // 조용히 빈 이미지가 나온다 — 여기서 멈추는 편이 낫다.
  const placement = videoContainRect({ width: video.videoWidth, height: video.videoHeight })
  if (!placement) return null

  const canvas = document.createElement('canvas')
  canvas.width = ANNOTATION_FRAME_WIDTH
  canvas.height = ANNOTATION_FRAME_HEIGHT

  const context = canvas.getContext('2d')
  if (!context) return null

  context.fillStyle = LETTERBOX_COLOR
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(video, placement.x, placement.y, placement.width, placement.height)

  await drawAnnotations(context, elements)

  return await toImageBlob(canvas)
}

/**
 * 판서를 프레임 위에 얹는다.
 *
 * <p><b>`exportToCanvas`의 원점은 프레임이 아니라 내용 바운딩 박스다.</b> 그래서 결과 캔버스를 그냥
 * (0,0)에 얹으면 판서가 밀린다 — 강사 화면에서는 정상으로 보이고 합성 이미지에서만 어긋나는,
 * 판서 합성에서 이미 밟은 함정이다(ADR-0051). 실제 바운딩 박스를 읽어 그 자리에 그린다.
 *
 * <p>출력이 논리 프레임과 같은 크기라 배율 보정이 없다. 배율이 끼면 그 자리가 곧 다음 버그가 된다.
 */
async function drawAnnotations(
  context: CanvasRenderingContext2D,
  elements: readonly AnnotationElement[],
): Promise<void> {
  if (elements.length === 0) return

  const { exportToCanvas, getCommonBounds } = await loadExcalidraw()
  const layer = await exportToCanvas({
    elements: elements as never,
    // 배경을 넣지 않는다 — 아래 깔린 영상이 보여야 한다.
    appState: { exportBackground: false } as never,
    files: null,
    exportPadding: 0,
    getDimensions: (width: number, height: number) => ({ width, height, scale: 1 }),
  })

  const [minX, minY] = getCommonBounds(elements as never)
  context.drawImage(layer, minX, minY, layer.width, layer.height)
}

function toImageBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, HIGHLIGHT_IMAGE_TYPE, HIGHLIGHT_IMAGE_QUALITY))
}
