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
    const pushedOut = clampOverlay({ visible: true, mirrored: true, x: 0.95, y: 0.95, w: 0.3 })
    expect(pushedOut.x).toBeCloseTo(0.7, 5)
    expect(pushedOut.y).toBeCloseTo(1 - overlayHeight(0.3), 5)
  })

  it('너무 작거나 큰 폭을 범위 안으로 되돌린다', () => {
    expect(clampOverlay({ visible: true, mirrored: true, x: 0, y: 0, w: 0.01 }).w).toBe(MIN_OVERLAY_WIDTH)
    expect(clampOverlay({ visible: true, mirrored: true, x: 0, y: 0, w: 0.9 }).w).toBe(MAX_OVERLAY_WIDTH)
  })

  it('metadata로 왕복해도 값이 유지된다', () => {
    const overlay = { visible: false, mirrored: false, x: 0.1, y: 0.2, w: 0.3 }
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

  /**
   * 뒤집기는 <b>강사 화면과 Egress가 같이 알아야</b> 하는 값이라 배치와 같은 통로로 싣는다(ADR-0100).
   *
   * <p>웹캠은 거울이 맞지만 <b>파일 송출은 아니다</b> — 미리 녹화한 영상을 뒤집으면 화면 속 글자가
   * 반전된 채 HLS·녹화에 들어가 VOD에 영구히 남는다. 강사 화면만 고치면 강사는 멀쩡해 보이는데
   * 수강생만 반전을 본다.
   */
  it('뒤집기를 metadata로 실어 나른다', () => {
    const notMirrored = { visible: true, mirrored: false, x: 0.7, y: 0.6, w: 0.25 }
    expect(parseCameraOverlay(withCameraOverlay(null, notMirrored)).mirrored).toBe(false)
    expect(parseCameraOverlay(withCameraOverlay(null, { ...notMirrored, mirrored: true })).mirrored).toBe(true)
  })

  /**
   * 이 키가 생기기 전 세션은 metadata에 `mirrored`가 없다. 그때 뒤집지 않으면 <b>진행 중인 강의의
   * 카메라가 갑자기 좌우로 뒤집힌다</b> — 없으면 지금까지의 동작(거울)으로 읽는다.
   */
  it('mirrored가 없는 옛 metadata는 거울로 읽는다', () => {
    const legacy = JSON.stringify({ cameraOverlay: { visible: true, x: 0.7, y: 0.6, w: 0.25 } })
    expect(parseCameraOverlay(legacy).mirrored).toBe(true)
  })

  it('기본값은 거울이다 — 웹캠이 기본 송출이다', () => {
    expect(DEFAULT_CAMERA_OVERLAY.mirrored).toBe(true)
  })

  it('저장할 때도 범위를 벗어난 값을 접는다', () => {
    const stored = JSON.parse(withCameraOverlay(null, { visible: true, mirrored: true, x: 2, y: -1, w: 5 })) as {
      cameraOverlay: { x: number; y: number; w: number }
    }
    expect(stored.cameraOverlay.w).toBe(MAX_OVERLAY_WIDTH)
    expect(stored.cameraOverlay.x).toBeGreaterThanOrEqual(0)
    expect(stored.cameraOverlay.y).toBeGreaterThanOrEqual(0)
  })
})
