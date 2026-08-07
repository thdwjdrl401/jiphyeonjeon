/**
 * 합성 화면에서 카메라를 어디에 어떤 크기로 얹을지. 강사 화면과 Egress 템플릿이 공유하는 계약이다.
 *
 * <p>강사가 조절한 배치가 그대로 수강생이 보는 녹화에 반영되어야 하므로, 이 값은 LiveKit room
 * metadata로 실려 두 화면이 같은 값을 읽는다. 강사가 보는 것과 수강생이 보는 것이 같아진다.
 *
 * <p><b>좌표는 0~1 비율이다.</b> 강사 미리보기와 합성 캔버스는 크기가 다르고(브라우저 창 vs
 * 1920x1080), 캔버스 해상도도 설정으로 바뀔 수 있다. 픽셀로 저장하면 둘이 어긋난다.
 */
export interface CameraOverlay {
  /** 합성 화면에 카메라를 표시할지. 끄면 화면공유만 나간다. */
  visible: boolean
  /** 왼쪽 위 모서리 위치(0~1). 0.72는 "가로 72% 지점". */
  x: number
  /** 위쪽 위치(0~1). */
  y: number
  /** 너비 비율(0~1). 높이는 16:9로 파생한다 — 카메라 트랙 비율을 따로 저장하지 않는다. */
  w: number
  /**
   * 카메라를 좌우로 뒤집을지. <b>웹캠은 뒤집는다</b> — 강사가 자기 얼굴을 거울로 보는 것이 이
   * 서비스의 기준이고, Egress 템플릿도 같은 방향으로 뒤집어 두 화면을 맞춘다.
   *
   * <p><b>파일 송출은 뒤집지 않는다</b>(ADR-0100). 미리 녹화한 영상은 거울상이 아니라서, 뒤집으면
   * 화면 속 글자가 반전되고 그대로 <b>녹화·VOD에 영구히 남는다</b>. 강사 화면만 고쳐서는 안 되고
   * Egress까지 같이 알아야 하므로 배치와 같은 통로(room metadata)로 싣는다.
   *
   * <p>값이 없는 옛 세션은 `true`로 읽는다 — 지금까지의 동작이 그것이다.
   */
  mirrored: boolean
}

/** 화면공유를 가리지 않는 우하단. 강사가 옮기기 전까지의 기본 배치다. */
export const DEFAULT_CAMERA_OVERLAY: CameraOverlay = { visible: true, x: 0.735, y: 0.66, w: 0.25, mirrored: true }

/** 너무 작으면 얼굴이 안 보이고, 너무 크면 화면공유를 덮는다. */
export const MIN_OVERLAY_WIDTH = 0.12
export const MAX_OVERLAY_WIDTH = 0.45

/** 합성 캔버스 비율(1920x1080). */
export const STAGE_ASPECT = 16 / 9
/** 카메라 타일 비율. 캔버스와 같으면 폭 비율과 높이 비율이 같아진다. */
export const CAMERA_ASPECT = 16 / 9

const METADATA_KEY = 'cameraOverlay'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 폭 비율 → 높이 비율.
 *
 * <p>폭 w는 캔버스 폭 W의 비율이므로 픽셀 폭은 {@code w·W}, 타일 높이는 {@code w·W / CAMERA_ASPECT}다.
 * 캔버스 높이 {@code H = W / STAGE_ASPECT}로 나누면 {@code w · STAGE_ASPECT / CAMERA_ASPECT}가 된다.
 * 지금은 둘 다 16:9라 결과가 w와 같지만, 비율이 갈릴 때를 위해 식으로 남긴다.
 */
export function overlayHeight(width: number) {
  return (width * STAGE_ASPECT) / CAMERA_ASPECT
}

/**
 * 오버레이가 캔버스를 벗어나지 않도록 접는다. 드래그로 밖에 놓으면 합성에서 잘려 나가는데,
 * 강사 화면에서는 잘린 게 보이지 않아 알아채기 어렵다.
 */
export function clampOverlay(overlay: CameraOverlay): CameraOverlay {
  const w = clamp(overlay.w, MIN_OVERLAY_WIDTH, MAX_OVERLAY_WIDTH)
  const h = overlayHeight(w)
  return {
    visible: overlay.visible,
    mirrored: overlay.mirrored,
    w,
    x: clamp(overlay.x, 0, 1 - w),
    y: clamp(overlay.y, 0, 1 - h),
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * room metadata 문자열에서 오버레이를 읽는다.
 *
 * <p>metadata는 우리만 쓰는 자리가 아닐 수 있고(다른 기능이 같은 JSON에 키를 더할 수 있다),
 * 옛 세션에는 아예 없을 수도 있다. 어느 경우든 기본 배치로 떨어뜨리고 화면은 계속 그린다 —
 * 녹화 중에 metadata 한 줄 때문에 화면이 멈추면 안 된다.
 */
export function parseCameraOverlay(metadata: string | undefined | null): CameraOverlay {
  if (!metadata) return DEFAULT_CAMERA_OVERLAY
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    const raw = parsed[METADATA_KEY] as Partial<CameraOverlay> | undefined
    if (!raw) return DEFAULT_CAMERA_OVERLAY
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.w)) {
      return DEFAULT_CAMERA_OVERLAY
    }
    return clampOverlay({
      visible: raw.visible !== false,
      // 없으면 뒤집는다 — 이 키가 생기기 전 세션과 웹캠 송출이 모두 그 동작이다.
      mirrored: raw.mirrored !== false,
      x: raw.x,
      y: raw.y,
      w: raw.w,
    })
  } catch {
    return DEFAULT_CAMERA_OVERLAY
  }
}

/**
 * 기존 metadata를 보존하면서 오버레이만 갈아 끼운다. 통째로 덮어쓰면 다른 기능이 넣은 값이 사라진다.
 */
export function withCameraOverlay(metadata: string | undefined | null, overlay: CameraOverlay): string {
  let base: Record<string, unknown> = {}
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
      // 파싱 못 하는 값은 우리가 쓴 것이 아니다. 덮어쓰기보다 새로 시작하는 편이 안전하다.
      base = {}
    }
  }
  return JSON.stringify({ ...base, [METADATA_KEY]: clampOverlay(overlay) })
}
