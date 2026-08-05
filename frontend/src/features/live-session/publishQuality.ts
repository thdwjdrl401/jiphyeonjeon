import { ScreenSharePresets, VideoPreset, VideoPresets } from 'livekit-client'

/**
 * 강사가 라이브 시작 전에 고르는 송출 품질.
 *
 * 강사가 올린 화질이 학생이 보는 화질의 상한이다 — 학생은 WebRTC로 직접 구독하지 않고
 * Egress 녹화를 HLS로만 보므로(ADR-0032), Egress에 도착하지 않은 화질은 어떤 서버 설정으로도
 * 복구되지 않는다. 실제로 강사 송출이 640x360으로 떨어져 있던 동안 Egress가 1080p로 재인코딩해도
 * 학생 화면은 3배 확대된 영상이었다.
 *
 * 그래서 이 선택은 "취향"이 아니라 학생이 보게 될 화질을 직접 정하는 값이다. 기본값은 가장 좋은
 * 화질이고, 강사 PC나 업링크가 감당하지 못할 때 낮추는 용도로 쓴다.
 *
 * 최고 화질 두 선택지는 LiveKit 프리셋을 그대로 쓰지 않고 비트레이트만 올린 값을 쓴다. 프리셋의
 * 기본값이 우리 용도(코드·슬라이드가 대부분인 1080p 화면)에는 부족해 글자 가장자리가 뭉갰다.
 * **최고 화질을 둘 다 고르면 업링크가 최대 13Mbps 필요하다**(화면 8 + 카메라 5).
 *
 * 사이멀캐스트는 여기서 고르게 하지 않는다 — 구독자가 Egress 하나뿐이라 항상 꺼야 하는 구조적
 * 선택이지 사용자 취향이 아니다.
 */
export type CameraQualityId = 'fhd' | 'hd' | 'sd'
export type ScreenQualityId = 'text' | 'motion' | 'light'

interface QualityOption<T extends string> {
  id: T
  label: string
  /** 선택지 옆에 붙는 한 줄. 무엇을 얻고 무엇을 내주는지 적는다. */
  hint: string
  preset: VideoPreset
}

/** 업링크 목표 비트레이트(Mbps). 프리셋의 maxBitrate에서 파생해 라벨에 쓴다. */
export function megabits(preset: VideoPreset) {
  return Math.round((preset.encoding.maxBitrate / 100_000)) / 10
}

/**
 * 카메라 최고 화질 프리셋.
 *
 * LiveKit의 `VideoPresets.h1080`은 **3,000kbps 고정**이라 1080p 30fps에서 프레임당 100kbit뿐이다.
 * 화면공유를 곁들일 때는 카메라가 25% 오버레이라 티가 안 나지만, **화면공유 없이 카메라만 켜면
 * 카메라가 합성 캔버스를 통째로 채우므로**(`EgressStagePage`의 `cameraIsStage`) 그대로 학생이
 * 보는 화질이 된다.
 *
 * 5,000kbps로 올려 프레임당 167kbit을 준다. 인물 영상은 화면공유보다 압축이 잘 들어 화면공유용
 * 8,000kbps까지는 필요 없다.
 */
const CAMERA_FHD_MAX = new VideoPreset(1920, 1080, 5_000_000, 30, 'medium')

export const CAMERA_QUALITIES: QualityOption<CameraQualityId>[] = [
  {
    id: 'fhd',
    label: '1080p',
    hint: '가장 선명합니다. 카메라만 켜고 진행하는 강의에 권장합니다.',
    preset: CAMERA_FHD_MAX,
  },
  {
    id: 'hd',
    label: '720p',
    hint: '노트북 CPU나 업로드 속도가 부족할 때 선택합니다.',
    preset: VideoPresets.h720,
  },
  {
    id: 'sd',
    label: '540p',
    hint: '연결이 불안정할 때 끊김을 우선합니다.',
    preset: VideoPresets.h540,
  },
]

/**
 * 화면공유 최고 화질 프리셋.
 *
 * LiveKit의 `ScreenSharePresets.h1080fps30`은 **5,000kbps 고정**이라 프레임당 167kbit뿐이다.
 * 코드·슬라이드처럼 가는 획이 많은 화면은 이 예산에서 글자 가장자리가 먼저 뭉갠다.
 *
 * 8,000kbps로 올리면 프레임당 267kbit이 된다. **여기가 학생이 보게 될 화질의 상한이다** —
 * Egress에 도착하지 않은 디테일은 서버에서 복구할 수 없으므로, 화질을 올리려면 반드시 이
 * 값부터 올려야 한다(Egress 비트레이트만 올리는 것은 효과가 없다).
 *
 * 해상도·프레임률은 그대로다. 늘어나는 것은 **강사 PC의 업링크 부담**뿐이라, 감당이 안 되는
 * 강사는 아래 낮은 선택지로 내리면 된다.
 */
const SCREEN_TEXT_MAX = new VideoPreset(1920, 1080, 8_000_000, 30, 'medium')

export const SCREEN_QUALITIES: QualityOption<ScreenQualityId>[] = [
  {
    id: 'text',
    label: '1080p · 30fps',
    hint: '코드·슬라이드 글자 판독을 우선합니다. 업로드가 가장 넓어야 합니다.',
    preset: SCREEN_TEXT_MAX,
  },
  {
    id: 'motion',
    label: '1080p · 15fps',
    hint: '화면이 거의 정지해 있다면 대역폭을 절반만 씁니다.',
    preset: ScreenSharePresets.h1080fps15,
  },
  {
    id: 'light',
    label: '720p · 30fps',
    hint: '업로드가 좁을 때. 작은 글자는 뭉갤 수 있습니다.',
    preset: ScreenSharePresets.h720fps30,
  },
]

export interface PublishQuality {
  camera: CameraQualityId
  screenShare: ScreenQualityId
}

/** 기본값은 최고 화질 — 강사가 낮추는 방향으로만 조정하게 한다. */
export const DEFAULT_PUBLISH_QUALITY: PublishQuality = { camera: 'fhd', screenShare: 'text' }

export function cameraPreset(quality: PublishQuality) {
  return (CAMERA_QUALITIES.find((option) => option.id === quality.camera) ?? CAMERA_QUALITIES[0]).preset
}

export function screenPreset(quality: PublishQuality) {
  return (SCREEN_QUALITIES.find((option) => option.id === quality.screenShare) ?? SCREEN_QUALITIES[0]).preset
}

const STORAGE_KEY = 'liveclass.publishQuality'

/**
 * 선택을 브라우저에 남긴다. 강사는 같은 장비로 반복해서 강의하므로, 한 번 낮춘 설정을
 * 매 세션 다시 고르게 하지 않는다. 저장소를 못 쓰는 환경(사파리 프라이빗 등)에서는 기본값으로 돈다.
 */
export function loadPublishQuality(): PublishQuality {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PUBLISH_QUALITY
    const parsed = JSON.parse(raw) as Partial<PublishQuality>
    return {
      camera: CAMERA_QUALITIES.some((o) => o.id === parsed.camera)
        ? parsed.camera as CameraQualityId
        : DEFAULT_PUBLISH_QUALITY.camera,
      screenShare: SCREEN_QUALITIES.some((o) => o.id === parsed.screenShare)
        ? parsed.screenShare as ScreenQualityId
        : DEFAULT_PUBLISH_QUALITY.screenShare,
    }
  } catch {
    return DEFAULT_PUBLISH_QUALITY
  }
}

export function savePublishQuality(quality: PublishQuality) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(quality))
  } catch {
    // 저장 실패는 기능을 막지 않는다 — 이번 세션에만 적용되고 끝난다.
  }
}
