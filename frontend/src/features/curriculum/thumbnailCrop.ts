/**
 * 대표 이미지 크롭 계산. <b>그리기(canvas)와 분리된 순수 계산</b>이다 — 좌표 계산이 틀리면
 * 강사가 고른 자리와 저장되는 자리가 어긋나는데, 그 검증을 canvas 없이 할 수 있어야 한다.
 *
 * <p>좌표계는 둘이다.
 * <ul>
 *   <li><b>프레임 좌표</b>: 화면에 보이는 16:9 틀. 원점은 틀의 좌상단이고 단위는 CSS px다.
 *   <li><b>원본 좌표</b>: 업로드한 파일의 픽셀. 서버로 보낼 잘린 이미지가 이 좌표로 잘린다.
 * </ul>
 */

/** 카드·목록이 쓰는 비율. 히어로(약 1.1:1)는 이보다 세로로 길어 좌우가 조금 잘린다(ADR-0087). */
export const THUMBNAIL_ASPECT_RATIO = 16 / 9

/** 잘라 낸 이미지의 가로 상한. 카드·히어로 어디서도 이보다 크게 표시되지 않는다. */
export const MAX_CROP_WIDTH = 1600

export interface Size {
  width: number
  height: number
}

export interface Offset {
  x: number
  y: number
}

export interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * 원본을 프레임에 <b>가득 채우는</b>(cover) 최소 배율. 이 배율보다 작으면 틀 안에 빈 자리가
 * 생기므로, 사용자 확대는 항상 이 값의 배수로만 다룬다.
 */
export function coverScale(natural: Size, frame: Size): number {
  if (natural.width <= 0 || natural.height <= 0) return 1
  return Math.max(frame.width / natural.width, frame.height / natural.height)
}

/** 프레임에 그려질 이미지의 실제 크기. `zoom`은 1 이상(1이면 꼭 맞게 채운 상태). */
export function displaySize(natural: Size, frame: Size, zoom: number): Size {
  const scale = coverScale(natural, frame) * Math.max(1, zoom)
  return { width: natural.width * scale, height: natural.height * scale }
}

/**
 * 이미지가 프레임을 <b>항상 덮도록</b> 이동량을 가둔다. 가두지 않으면 드래그로 틀 밖까지 끌어
 * 한지색 빈 자리가 보이고, 그 상태로 저장하면 잘린 이미지에 빈 띠가 들어간다.
 *
 * <p>이동량은 0 이하다 — 이미지 좌상단이 틀 좌상단보다 오른쪽/아래로 갈 수 없다.
 */
export function clampOffset(display: Size, frame: Size, offset: Offset): Offset {
  const minX = Math.min(0, frame.width - display.width)
  const minY = Math.min(0, frame.height - display.height)
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  }
}

/**
 * 지금 프레임에 보이는 영역을 원본 좌표의 사각형으로 바꾼다. 이 사각형이 곧 잘라 낼 범위다.
 *
 * <p>반올림하지 않는다 — canvas의 `drawImage`가 소수 좌표를 그대로 받고, 여기서 정수로 맞추면
 * 확대 배율이 클 때 한 픽셀씩 밀린다. 대신 원본 밖으로 나가지 않게 가둔다.
 */
export function toSourceRect(natural: Size, frame: Size, zoom: number, offset: Offset): SourceRect {
  const display = displaySize(natural, frame, zoom)
  const safeOffset = clampOffset(display, frame, offset)
  const scale = display.width / natural.width

  const sw = Math.min(natural.width, frame.width / scale)
  const sh = Math.min(natural.height, frame.height / scale)
  return {
    sx: Math.min(Math.max(0, -safeOffset.x / scale), natural.width - sw),
    sy: Math.min(Math.max(0, -safeOffset.y / scale), natural.height - sh),
    sw,
    sh,
  }
}

/**
 * 잘라 낸 이미지를 몇 픽셀로 저장할지. 비율은 프레임과 같게 두고 가로만 상한으로 줄인다.
 *
 * <p>원본보다 크게 만들지 않는다 — 작은 사진을 늘려 저장하면 용량만 늘고 화질은 그대로다.
 */
export function cropOutputSize(source: SourceRect, maxWidth = MAX_CROP_WIDTH): Size {
  const width = Math.max(1, Math.round(Math.min(source.sw, maxWidth)))
  return { width, height: Math.max(1, Math.round(width / THUMBNAIL_ASPECT_RATIO)) }
}

/** 프레임 폭에 맞는 16:9 높이. 화면 폭이 달라도 틀 비율은 흔들리지 않게 한 곳에서 계산한다. */
export function frameSizeFor(width: number): Size {
  return { width, height: Math.round(width / THUMBNAIL_ASPECT_RATIO) }
}
