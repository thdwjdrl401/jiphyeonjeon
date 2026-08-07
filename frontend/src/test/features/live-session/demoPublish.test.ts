import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armDemoPublish,
  createDemoTracks,
  demoHasAudio,
  demoPublishState,
  disarmDemoPublish,
  releaseDemoTracks,
} from '@/features/live-session/demoPublish'

/**
 * 시연용 파일 송출(ADR-0100).
 *
 * <p>여기서 지키는 것 중 <b>제일 중요한 것은 새로고침</b>이다. `File`은 새로고침을 넘지 못하는데
 * 무장 여부는 `sessionStorage`에 남는다. 그 비대칭이 안전 장치다 — 파일을 잃었을 때 진짜 카메라로
 * 조용히 되돌아가면, 시연 도중 새로고침 한 번에 <b>발표자의 실제 방이 수강생 화면에 뜬다</b>.
 * 그래서 "무장됐지만 준비 안 됨"이라는 상태가 반드시 있어야 하고, 이 파일이 그것을 못 박는다.
 */
function fakeVideoElement(options: { audio?: boolean; captureStream?: boolean } = {}) {
  const { audio = true, captureStream = true } = options
  const videoTrack = { kind: 'video', readyState: 'live' } as MediaStreamTrack
  const audioTrack = { kind: 'audio', readyState: 'live' } as MediaStreamTrack
  const element = {
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    src: '',
    loop: false,
    playsInline: false,
    ...(captureStream
      ? {
        captureStream: () => ({
          getVideoTracks: () => [videoTrack],
          getAudioTracks: () => (audio ? [audioTrack] : []),
        }),
      }
      : {}),
  }
  return { element, videoTrack, audioTrack }
}

let created: ReturnType<typeof fakeVideoElement>

function installVideoElement(options?: { audio?: boolean; captureStream?: boolean }) {
  created = fakeVideoElement(options)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'video') return created.element as unknown as HTMLElement
    return document.createElement.call(document, tag) as HTMLElement
  }) as typeof document.createElement)
  return created
}

const file = (name = 'demo.mp4') => new File(['x'], name, { type: 'video/mp4' })

beforeEach(() => {
  sessionStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:demo')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  disarmDemoPublish()
  releaseDemoTracks()
  vi.restoreAllMocks()
})

describe('데모 송출 소스', () => {
  it('무장하면 파일 이름과 함께 준비됐다고 말한다', () => {
    armDemoPublish(file('강의녹화.mp4'))
    expect(demoPublishState()).toMatchObject({ armed: true, ready: true, fileName: '강의녹화.mp4' })
  })

  /**
   * 새로고침 재현. `sessionStorage`의 무장 표시는 살아남고 모듈의 `File`은 사라진다 — 그때
   * <b>준비되지 않았다</b>고 말해야 화면이 카메라로 되돌아가지 않고 다시 고르라고 할 수 있다.
   */
  it('새로고침을 넘으면 무장은 남고 파일은 사라진다', async () => {
    armDemoPublish(file())
    // 모듈을 새로 불러오는 것이 새로고침이다. sessionStorage는 그대로 둔다.
    vi.resetModules()
    const reloaded = await import('@/features/live-session/demoPublish')

    expect(reloaded.demoPublishState()).toMatchObject({ armed: true, ready: false, fileName: null })
    await expect(reloaded.createDemoTracks()).rejects.toThrow(/선택되지 않았/)
  })

  it('데모를 끄면 무장도 파일도 사라진다', () => {
    armDemoPublish(file())
    disarmDemoPublish()
    expect(demoPublishState()).toMatchObject({ armed: false, ready: false })
  })

  it('영상·소리 트랙을 뽑고 반복 재생으로 둔다', async () => {
    const { element, videoTrack, audioTrack } = installVideoElement()
    armDemoPublish(file())

    const tracks = await createDemoTracks()

    expect(tracks.video).toBe(videoTrack)
    expect(tracks.audio).toBe(audioTrack)
    expect(element.loop).toBe(true)
    expect(element.play).toHaveBeenCalled()
    expect(demoHasAudio()).toBe(true)
  })

  /**
   * 화질을 바꾸면 트랙을 내렸다 다시 올린다. 그때 파일을 새로 열면 <b>영상이 처음으로 되감긴다</b> —
   * 시연 도중 화질 한 번 바꿨다고 강의가 처음으로 돌아가면 안 된다.
   */
  it('이미 돌고 있으면 다시 열지 않는다', async () => {
    const { element } = installVideoElement()
    armDemoPublish(file())

    const first = await createDemoTracks()
    const second = await createDemoTracks()

    expect(second).toBe(first)
    expect(element.play).toHaveBeenCalledTimes(1)
  })

  it('소리가 없는 파일도 올리되 없다고 말한다', async () => {
    // 막지 않는다 — 영상은 나가야 한다. 다만 자막·노트·AI가 빈다는 사실은 화면이 알려야 한다.
    installVideoElement({ audio: false })
    armDemoPublish(file())

    const tracks = await createDemoTracks()

    expect(tracks.video).toBeTruthy()
    expect(tracks.audio).toBeNull()
    expect(demoHasAudio()).toBe(false)
  })

  it('captureStream이 없는 브라우저면 무엇을 하라고 말한다', async () => {
    // Safari가 이 경우다. "실패했습니다"만 뜨면 시연 직전에 원인을 못 찾는다.
    installVideoElement({ captureStream: false })
    armDemoPublish(file())

    await expect(createDemoTracks()).rejects.toThrow(/Chrome/)
  })

  it('재생이 막히면 파일 문제인지 자동재생 문제인지 구분해 말한다', async () => {
    const { element } = installVideoElement()
    element.play = vi.fn(async () => {
      throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    })
    armDemoPublish(file())

    await expect(createDemoTracks()).rejects.toThrow(/자동 재생/)
  })

  it('코덱을 못 읽으면 무엇으로 인코딩해야 하는지 말한다', async () => {
    const { element } = installVideoElement()
    element.play = vi.fn(async () => { throw new Error('decode failed') })
    armDemoPublish(file())

    await expect(createDemoTracks()).rejects.toThrow(/H\.264/)
  })
})
