import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DemoTransport from '@/features/live-session/DemoTransport'
import { armDemoPublish, createDemoTracks, disarmDemoPublish, releaseDemoTracks } from '@/features/live-session/demoPublish'

/**
 * 데모 영상 재생 제어(ADR-0100).
 *
 * <p><b>로컬 재생 제어가 아니라 송출 제어다.</b> element를 멈추면 `captureStream()`이 내보내던
 * 프레임과 소리가 함께 멈춘다 — 수강생 화면이 정지 화면이 되고 녹화에도 그대로 남는다.
 * 그래서 여기서 지키는 것은 "버튼이 element를 실제로 움직이는가"이지 화면 상태 흉내가 아니다.
 */
function fakeVideoElement() {
  const listeners = new Map<string, Set<() => void>>()
  const element = {
    paused: true,
    currentTime: 0,
    duration: 300,
    play: vi.fn(async () => { element.paused = false; emit('play') }),
    pause: vi.fn(() => { element.paused = true; emit('pause') }),
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener) },
    removeAttribute: vi.fn(),
    load: vi.fn(),
    src: '',
    loop: false,
    playsInline: false,
    captureStream: () => ({
      getVideoTracks: () => [{ kind: 'video', readyState: 'live' } as MediaStreamTrack],
      getAudioTracks: () => [{ kind: 'audio', readyState: 'live' } as MediaStreamTrack],
    }),
  }
  function emit(type: string) {
    for (const listener of [...(listeners.get(type) ?? [])]) listener()
  }
  return { element, emit }
}

let created: ReturnType<typeof fakeVideoElement>
let createElementSpy: { mockRestore: () => void } | null = null

async function mountWithSource() {
  const original = document.createElement.bind(document)
  created = fakeVideoElement()
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'video' ? created.element : original(tag)) as typeof document.createElement)

  armDemoPublish(new File(['x'], 'demo.mp4', { type: 'video/mp4' }))
  await act(async () => { await createDemoTracks() })
  return render(<DemoTransport />)
}

beforeEach(() => {
  sessionStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:demo')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  disarmDemoPublish()
  releaseDemoTracks()
  createElementSpy?.mockRestore()
  createElementSpy = null
})

describe('데모 영상 재생 제어', () => {
  /** 송출을 시작해야 element가 생긴다. 그 전에 손잡이를 그리면 누를 게 없는 버튼이 남는다. */
  it('송출 전에는 아무것도 그리지 않는다', () => {
    const { container } = render(<DemoTransport />)
    expect(container).toBeEmptyDOMElement()
  })

  /** 송출이 시작되면 이미 재생 중이다(`createDemoTracks`가 `play()`한다). 그래서 첫 버튼은 정지다. */
  it('일시정지·재생이 element를 실제로 움직인다', async () => {
    const user = userEvent.setup()
    await mountWithSource()

    await user.click(screen.getByRole('button', { name: '일시정지' }))
    expect(created.element.pause).toHaveBeenCalled()

    // 라벨이 상태를 따라간다 — 눌러야 할 것과 지금 상태를 헷갈리면 안 된다.
    await user.click(await screen.findByRole('button', { name: '재생' }))
    expect(created.element.play).toHaveBeenCalledTimes(2)
  })

  it('앞뒤로 감으면 재생 위치가 옮겨진다', async () => {
    const user = userEvent.setup()
    await mountWithSource()
    act(() => { created.element.currentTime = 100; created.emit('timeupdate') })

    await user.click(screen.getByRole('button', { name: '10초 앞으로' }))
    expect(created.element.currentTime).toBe(110)

    act(() => { created.emit('timeupdate') })
    await user.click(screen.getByRole('button', { name: '10초 뒤로' }))
    expect(created.element.currentTime).toBe(100)
  })

  it('영상 시작·끝을 넘어가지 않는다', async () => {
    const user = userEvent.setup()
    await mountWithSource()

    // 0초에서 뒤로 감아도 음수가 되면 안 된다.
    await user.click(screen.getByRole('button', { name: '10초 뒤로' }))
    expect(created.element.currentTime).toBe(0)

    act(() => { created.element.currentTime = 295; created.emit('timeupdate') })
    await user.click(screen.getByRole('button', { name: '10초 앞으로' }))
    expect(created.element.currentTime).toBe(300)
  })

  /** 반복 재생으로 0으로 되감기는 것처럼 우리를 거치지 않는 변화도 화면에 반영돼야 한다. */
  it('우리가 옮기지 않은 변화도 시간 표시에 반영한다', async () => {
    await mountWithSource()
    act(() => { created.element.currentTime = 65; created.emit('timeupdate') })

    expect(screen.getByText('01:05 / 05:00')).toBeInTheDocument()
  })
})
