import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDemoAudioFile,
  closeDemoAudioTrack,
  demoAudioState,
  openDemoAudioTrack,
  seekDemoAudio,
  selectDemoAudioFile,
  setDemoAudioLoop,
} from '@/features/live-session/demoAudio'

/**
 * 시연 음성 소스(ADR-0103).
 *
 * <p>여기서 지키는 성질은 하나로 모인다 — <b>고르는 것과 트는 것은 다르다.</b> 파일을 골라 두어도
 * 마이크는 진짜 마이크 그대로여야 하고, 재생을 누른 뒤에야 트랙이 생긴다. 이 구분이 무너지면
 * 강의에 들어가자마자 녹음이 나가 인사도 못 한다.
 */
const audioTrack = { kind: 'audio', stop: vi.fn() } as unknown as MediaStreamTrack

function stubAudioElement() {
  const listeners = new Map<string, () => void>()
  const element = {
    paused: false,
    ended: false,
    loop: false,
    muted: false,
    currentTime: 0,
    duration: 180,
    src: '',
    captureStream: () => ({ getAudioTracks: () => [audioTrack] }),
    play: vi.fn(async () => { element.paused = false }),
    pause: vi.fn(() => { element.paused = true }),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: (type: string, handler: () => void) => { listeners.set(type, handler) },
  }
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'audio') return element as unknown as HTMLElement
    return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement
  }) as typeof document.createElement)
  return { element, fire: (type: string) => listeners.get(type)?.() }
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:demo')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  closeDemoAudioTrack()
  clearDemoAudioFile()
  setDemoAudioLoop(false)
  vi.restoreAllMocks()
})

function pickFile(name = 'demo.m4a') {
  selectDemoAudioFile(new File(['x'], name, { type: 'audio/mp4' }))
}

describe('시연 음성 소스', () => {
  it('파일을 골라도 트랙은 생기지 않는다 — 재생을 눌러야 마이크가 바뀐다', () => {
    pickFile()

    const state = demoAudioState()
    expect(state.fileName).toBe('demo.m4a')
    expect(state.live).toBe(false)
  })

  it('파일이 없으면 재생을 거절한다', async () => {
    await expect(openDemoAudioTrack(vi.fn())).rejects.toThrow(/선택/)
  })

  it('재생하면 오디오 트랙을 내고 live가 된다', async () => {
    stubAudioElement()
    pickFile()

    const track = await openDemoAudioTrack(vi.fn())

    expect(track).toBe(audioTrack)
    expect(demoAudioState().live).toBe(true)
    expect(demoAudioState().durationMs).toBe(180_000)
  })

  /** `captureStream()`이 없는 브라우저(Safari)에서 시연 도중 터지면 안 된다. */
  it('captureStream이 없으면 브라우저를 짚어 알린다', async () => {
    vi.spyOn(document, 'createElement').mockReturnValue({} as HTMLElement)
    pickFile()

    await expect(openDemoAudioTrack(vi.fn())).rejects.toThrow(/Chrome/)
  })

  /**
   * 끝나면 진짜 마이크로 돌아가라는 신호다. 이것이 안 오면 파일이 끝난 뒤에도 마이크 자리에
   * <b>무음 트랙</b>이 남아, 강사가 말해도 아무에게도 들리지 않는다.
   */
  it('파일이 끝나면 알린다', async () => {
    const { fire } = stubAudioElement()
    const onEnded = vi.fn()
    pickFile()
    await openDemoAudioTrack(onEnded)

    fire('ended')

    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('반복을 켜면 element.loop에 실린다 — 반복 중에는 ended가 오지 않는다', async () => {
    const { element } = stubAudioElement()
    pickFile()
    setDemoAudioLoop(true)

    await openDemoAudioTrack(vi.fn())

    expect(element.loop).toBe(true)
    expect(demoAudioState().loop).toBe(true)
  })

  it('재생 중에 반복을 바꾸면 곧바로 반영된다', async () => {
    const { element } = stubAudioElement()
    pickFile()
    await openDemoAudioTrack(vi.fn())

    setDemoAudioLoop(true)

    expect(element.loop).toBe(true)
  })

  it('구간을 옮기면 재생 위치가 따라간다', async () => {
    stubAudioElement()
    pickFile()
    await openDemoAudioTrack(vi.fn())

    seekDemoAudio(42_000)

    expect(demoAudioState().positionMs).toBe(42_000)
  })

  /**
   * 캡처한 트랙은 <b>우리가</b> 멈춘다. LiveKit은 `providedByUser`인 트랙을 대신 멈춰 주지 않아서
   * (`LocalTrack.replaceTrack`), 여기서 안 멈추면 파일이 계속 열린 채로 남는다.
   */
  it('닫으면 트랙을 멈추고 파일은 남긴다 — 다시 틀 수 있어야 한다', async () => {
    stubAudioElement()
    pickFile()
    await openDemoAudioTrack(vi.fn())

    closeDemoAudioTrack()

    expect(audioTrack.stop).toHaveBeenCalled()
    expect(demoAudioState().live).toBe(false)
    expect(demoAudioState().fileName).toBe('demo.m4a')
  })

  /** 메타데이터 전에는 duration이 NaN이다. 그대로 내보내면 재생바가 NaN%가 된다. */
  it('길이를 아직 모르면 0으로 낸다', async () => {
    const { element } = stubAudioElement()
    element.duration = Number.NaN
    pickFile()
    await openDemoAudioTrack(vi.fn())

    expect(demoAudioState().durationMs).toBe(0)
  })
})
