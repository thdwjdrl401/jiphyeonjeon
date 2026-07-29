import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAMERA_OVERLAY,
  MAX_OVERLAY_WIDTH,
  MIN_OVERLAY_WIDTH,
  clampOverlay,
  overlayHeight,
  parseCameraOverlay,
  withCameraOverlay,
} from '@/features/live-session/cameraOverlay'

describe('카메라 오버레이 계약', () => {
  // 강사 화면과 Egress 템플릿이 같은 값을 읽어야 "보이는 대로 녹화된다"가 성립한다.
  it('기본 배치는 화면공유를 가리지 않는 우하단이다', () => {
    expect(DEFAULT_CAMERA_OVERLAY.visible).toBe(true)
    expect(DEFAULT_CAMERA_OVERLAY.x + DEFAULT_CAMERA_OVERLAY.w).toBeLessThanOrEqual(1)
    expect(DEFAULT_CAMERA_OVERLAY.y + overlayHeight(DEFAULT_CAMERA_OVERLAY.w)).toBeLessThanOrEqual(1)
  })

  // 캔버스와 타일이 모두 16:9라 폭 비율과 높이 비율이 같다. 식이 바뀌면 여기서 잡힌다.
  it('폭 비율에서 높이 비율을 파생한다', () => {
    expect(overlayHeight(0.25)).toBeCloseTo(0.25, 5)
    expect(overlayHeight(0.4)).toBeCloseTo(0.4, 5)
  })

  it('캔버스를 벗어나지 않게 접는다', () => {
    const pushedOut = clampOverlay({ visible: true, x: 0.95, y: 0.95, w: 0.3 })
    expect(pushedOut.x).toBeCloseTo(0.7, 5)
    expect(pushedOut.y).toBeCloseTo(1 - overlayHeight(0.3), 5)
  })

  it('너무 작거나 큰 폭을 범위 안으로 되돌린다', () => {
    expect(clampOverlay({ visible: true, x: 0, y: 0, w: 0.01 }).w).toBe(MIN_OVERLAY_WIDTH)
    expect(clampOverlay({ visible: true, x: 0, y: 0, w: 0.9 }).w).toBe(MAX_OVERLAY_WIDTH)
  })

  it('metadata로 왕복해도 값이 유지된다', () => {
    const overlay = { visible: false, x: 0.1, y: 0.2, w: 0.3 }
    expect(parseCameraOverlay(withCameraOverlay(null, overlay))).toEqual(overlay)
  })

  // metadata는 우리만 쓰는 자리가 아니다. 통째로 덮어쓰면 다른 기능의 값이 사라진다.
  it('기존 metadata의 다른 키를 보존한다', () => {
    const before = JSON.stringify({ sttSessionId: 'stt-1', other: { a: 1 } })
    const after = JSON.parse(withCameraOverlay(before, DEFAULT_CAMERA_OVERLAY)) as Record<string, unknown>
    expect(after.sttSessionId).toBe('stt-1')
    expect(after.other).toEqual({ a: 1 })
    expect(after.cameraOverlay).toBeTruthy()
  })

  // 녹화 중에 metadata 한 줄 때문에 합성 화면이 멈추면 안 된다. 어떤 입력이든 그려낼 값을 준다.
  it.each([
    ['빈 값', ''],
    ['null', null],
    ['깨진 JSON', '{not json'],
    ['키 없음', '{"other":1}'],
    ['숫자가 아닌 좌표', '{"cameraOverlay":{"x":"a","y":0.1,"w":0.2}}'],
    ['배열', '[1,2,3]'],
  ])('%s 이면 기본 배치로 떨어진다', (_label, metadata) => {
    expect(parseCameraOverlay(metadata)).toEqual(DEFAULT_CAMERA_OVERLAY)
  })

  it('저장할 때도 범위를 벗어난 값을 접는다', () => {
    const stored = JSON.parse(withCameraOverlay(null, { visible: true, x: 2, y: -1, w: 5 })) as {
      cameraOverlay: { x: number; y: number; w: number }
    }
    expect(stored.cameraOverlay.w).toBe(MAX_OVERLAY_WIDTH)
    expect(stored.cameraOverlay.x).toBeGreaterThanOrEqual(0)
    expect(stored.cameraOverlay.y).toBeGreaterThanOrEqual(0)
  })
})
