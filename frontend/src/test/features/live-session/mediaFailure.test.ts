import { describe, expect, it, vi } from 'vitest'
import {
  classifyMediaError,
  describeMediaFailure,
  hasInputDevice,
  preflightMediaFailure,
  queryMediaPermission,
  watchMediaPermission,
} from '@/features/live-session/mediaFailure'

/** 브라우저가 던지는 것과 같은 모양. name만 보고 가른다. */
function domError(name: string, message = '') {
  const error = new Error(message)
  error.name = name
  return error
}

describe('장치 실패 분류', () => {
  it('NotAllowedError는 권한 상태로 갈린다 — 차단이면 다시 물어볼 수 없다', () => {
    const error = domError('NotAllowedError', 'Permission denied')
    expect(classifyMediaError(error, 'microphone', 'denied')).toBe('blocked')
    expect(classifyMediaError(error, 'microphone', 'prompt')).toBe('dismissed')
    // 권한 조회를 지원하지 않는 브라우저에서는 "차단"으로 단정하지 않는다.
    expect(classifyMediaError(error, 'microphone', 'unknown')).toBe('dismissed')
  })

  it('화면 공유의 NotAllowedError는 실패가 아니라 강사가 창을 닫은 것이다', () => {
    expect(classifyMediaError(domError('NotAllowedError'), 'screenShare', 'unknown')).toBe('canceled')
  })

  it('운영에서 난 오류를 장치 없음으로 옮긴다', () => {
    // 크롬이 마이크가 없는 컴퓨터에서 돌려준 원문.
    const actual = domError('NotFoundError', 'Requested device not found')
    expect(classifyMediaError(actual, 'microphone', 'granted')).toBe('no-device')

    const failure = describeMediaFailure(actual, 'microphone', 'granted')
    expect(failure.title).toBe('마이크를 찾지 못했습니다')
    expect(failure.detail).toContain('권한 문제가 아닙니다')
    expect(failure.needsBrowserSetting).toBe(false)
    // 원문이 강사 눈에 남지 않는다.
    expect(`${failure.title}${failure.detail}${failure.action}`).not.toContain('Requested device not found')
  })

  it('나머지 이름도 각자 다른 원인으로 간다', () => {
    expect(classifyMediaError(domError('NotReadableError'), 'microphone', 'granted')).toBe('in-use')
    expect(classifyMediaError(domError('OverconstrainedError'), 'camera', 'granted')).toBe('overconstrained')
    expect(classifyMediaError(domError('TypeError'), 'microphone', 'unknown')).toBe('unsupported')
    expect(classifyMediaError(domError('SecurityError'), 'microphone', 'unknown')).toBe('unsupported')
  })

  it('차단 상태에서는 다시 시도를 내주지 않는다 — 눌러도 창이 뜨지 않기 때문이다', () => {
    const blocked = describeMediaFailure(domError('NotAllowedError'), 'microphone', 'denied')
    expect(blocked.retryable).toBe(false)
    expect(blocked.needsBrowserSetting).toBe(true)
    expect(blocked.action).toContain('사이트 설정')

    const dismissed = describeMediaFailure(domError('NotAllowedError'), 'microphone', 'prompt')
    expect(dismissed.retryable).toBe(true)
    // "이번만 허용"이 끝난 경우도 같은 자리로 온다. 강사가 왜 다시 물어보는지 알아야 한다.
    expect(dismissed.detail).toContain('이번만 허용')
  })

  it('분류에 없는 오류라도 원문을 버리지 않는다', () => {
    const failure = describeMediaFailure(domError('WeirdError', 'something odd'), 'camera', 'granted')
    expect(failure.cause).toBe('unknown')
    expect(failure.detail).toBe('something odd')
  })

  it('안내는 장치 이름을 그대로 부른다', () => {
    expect(describeMediaFailure(domError('NotFoundError'), 'camera', 'granted').title).toContain('카메라')
    expect(describeMediaFailure(domError('NotFoundError'), 'microphone', 'granted').title).toContain('마이크')
  })
})

describe('요청 전에 가려낼 수 있는 실패', () => {
  it('권한이 차단이면 요청하지 않고 바로 안내한다', () => {
    const failure = preflightMediaFailure('microphone', 'denied', true)
    expect(failure?.cause).toBe('blocked')
  })

  it('장치가 없으면 권한이 있어도 실패다', () => {
    expect(preflightMediaFailure('microphone', 'granted', false)?.cause).toBe('no-device')
  })

  it('장치 존재를 모를 때는 막지 않는다 — 모른다가 없다는 뜻은 아니다', () => {
    expect(preflightMediaFailure('microphone', 'granted', 'unknown')).toBeNull()
    expect(preflightMediaFailure('microphone', 'prompt', 'unknown')).toBeNull()
  })
})

describe('권한·장치 조회', () => {
  it('권한 조회를 지원하지 않으면 unknown이다 — 없다고 단정하지 않는다', async () => {
    const original = navigator.permissions
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined })
    await expect(queryMediaPermission('microphone')).resolves.toBe('unknown')
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: original })
  })

  it('마이크 이름을 모르는 브라우저가 던져도 unknown으로 받는다', async () => {
    const original = navigator.permissions
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockRejectedValue(new TypeError('unsupported name')) },
    })
    await expect(queryMediaPermission('microphone')).resolves.toBe('unknown')
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: original })
  })

  it('권한이 바뀌면 알려 주고, 구독을 끊으면 더 알리지 않는다', async () => {
    const listeners: Array<() => void> = []
    const status = {
      state: 'prompt' as PermissionState,
      addEventListener: (_: string, handler: () => void) => listeners.push(handler),
      removeEventListener: () => listeners.splice(0, listeners.length),
    }
    const original = navigator.permissions
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue(status) },
    })

    const seen: string[] = []
    const stop = watchMediaPermission('microphone', (next) => seen.push(next))
    await Promise.resolve()
    await Promise.resolve()

    status.state = 'granted' as PermissionState
    listeners.forEach((handler) => handler())
    expect(seen).toEqual(['granted'])

    stop()
    listeners.forEach((handler) => handler())
    expect(seen).toEqual(['granted'])

    Object.defineProperty(navigator, 'permissions', { configurable: true, value: original })
  })

  it('오디오 입력 장치가 하나도 없으면 false다 — 이 사건의 실제 상태', async () => {
    const original = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([{ kind: 'videoinput', label: 'Camera Sensor OV02C10' }]),
      },
    })
    await expect(hasInputDevice('microphone')).resolves.toBe(false)
    await expect(hasInputDevice('camera')).resolves.toBe(true)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original })
  })
})
