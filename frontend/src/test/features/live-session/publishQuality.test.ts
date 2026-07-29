import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAMERA_QUALITIES,
  DEFAULT_PUBLISH_QUALITY,
  SCREEN_QUALITIES,
  cameraPreset,
  loadPublishQuality,
  megabits,
  savePublishQuality,
  screenPreset,
} from '@/features/live-session/publishQuality'

describe('송출 품질 설정', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  // 기본값이 최고 화질이어야 한다 — 강사가 아무것도 고르지 않아도 수강생이 최선의 화질을 본다.
  // 낮추는 건 명시적 선택이어야 한다.
  it('기본값은 카메라·화면공유 모두 최고 화질이다', () => {
    expect(loadPublishQuality()).toEqual(DEFAULT_PUBLISH_QUALITY)
    expect(cameraPreset(DEFAULT_PUBLISH_QUALITY).resolution.height).toBe(1080)
    expect(screenPreset(DEFAULT_PUBLISH_QUALITY).resolution.height).toBe(1080)
    expect(screenPreset(DEFAULT_PUBLISH_QUALITY).encoding.maxFramerate).toBe(30)
  })

  it('선택을 저장하고 다시 읽는다', () => {
    savePublishQuality({ camera: 'hd', screenShare: 'light' })
    expect(loadPublishQuality()).toEqual({ camera: 'hd', screenShare: 'light' })
    expect(cameraPreset({ camera: 'hd', screenShare: 'light' }).resolution.height).toBe(720)
  })

  // 저장된 값이 오염됐을 때 화면이 죽는 대신 기본값으로 돈다. 이 값은 사용자가 직접 편집할 수 있는
  // localStorage에 있고, 프리셋 id가 바뀌면 옛 값이 남는다.
  it('알 수 없는 값이 저장돼 있으면 기본값으로 되돌린다', () => {
    window.localStorage.setItem('liveclass.publishQuality', JSON.stringify({ camera: '8k', screenShare: null }))
    expect(loadPublishQuality()).toEqual(DEFAULT_PUBLISH_QUALITY)
  })

  it('깨진 JSON이어도 기본값을 준다', () => {
    window.localStorage.setItem('liveclass.publishQuality', '{not json')
    expect(loadPublishQuality()).toEqual(DEFAULT_PUBLISH_QUALITY)
  })

  // 저장소를 못 쓰는 환경(프라이빗 모드 등)에서 설정 변경이 예외로 터지면 강의 시작 자체가 막힌다.
  it('localStorage 접근이 실패해도 예외를 던지지 않는다', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => savePublishQuality({ camera: 'sd', screenShare: 'motion' })).not.toThrow()
    spy.mockRestore()
  })

  it('선택지는 화질 내림차순이고 업로드 대역폭도 함께 낮아진다', () => {
    const cameraRates = CAMERA_QUALITIES.map((option) => megabits(option.preset))
    const screenRates = SCREEN_QUALITIES.map((option) => megabits(option.preset))
    expect(cameraRates).toEqual([...cameraRates].sort((a, b) => b - a))
    expect(screenRates).toEqual([...screenRates].sort((a, b) => b - a))
    expect(new Set(CAMERA_QUALITIES.map((o) => o.id)).size).toBe(CAMERA_QUALITIES.length)
    expect(new Set(SCREEN_QUALITIES.map((o) => o.id)).size).toBe(SCREEN_QUALITIES.length)
  })
})
