import { act, render, waitFor } from '@testing-library/react'
import {
  RemoteAudioTrack,
  RemoteVideoTrack,
  RoomEvent,
  Track,
  type RemoteTrackPublication,
} from 'livekit-client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EgressStagePage from '@/pages/EgressStagePage'

/**
 * Egress 합성 페이지의 <b>오디오 계약</b>을 잠근다.
 *
 * <p>Egress는 트랙을 직접 믹스하지 않고 헤드리스 Chrome의 재생 출력을 pulseaudio로 캡처한다. 그래서
 * 이 페이지가 오디오 트랙을 attach하지 않거나 element를 음소거하면 <b>라이브 HLS와 녹화가 전부
 * 무음</b>이 된다. 수강생은 ADR-0032에 따라 이 합성 결과만 보므로 다른 경로로 복구되지 않는다.
 *
 * <p>실제로 그 사고가 났다: 합성 페이지가 `RemoteVideoTrack`만 attach하고 오디오를 버렸다. 자막은
 * 정상이었기 때문에(STT 에이전트는 LiveKit에서 직접 받는다) 오디오가 방까지는 잘 도착한다는 것이
 * 확인됐고, 문제는 합성 단계 한 곳이었다. 로컬에서는 소리를 들어 검증할 수 없으니(Egress는 EC2에
 * 배포된 프론트를 연다) 계약을 테스트로 고정한다.
 */

interface FakeRoomHandle {
  canPlaybackAudio: boolean
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  startAudio: ReturnType<typeof vi.fn>
  remoteParticipants: Map<string, unknown>
  emit: (event: string, ...args: unknown[]) => void
}

const livekit = vi.hoisted(() => ({ rooms: [] as FakeRoomHandle[] }))

// Room만 대체한다. `RemoteAudioTrack`·`RemoteVideoTrack`·`Track`·`RoomEvent`는 실제 구현을 그대로
// 쓴다 — 페이지가 `instanceof`와 enum 값으로 분기하므로, 그것들을 흉내내면 라이브러리가 값을 바꿨을 때
// 테스트만 통과하는 상태가 된다.
vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>()

  class FakeRoom {
    private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>()

    canPlaybackAudio = true

    remoteParticipants = new Map<string, unknown>()

    connect = vi.fn(() => Promise.resolve())

    disconnect = vi.fn(() => Promise.resolve())

    startAudio = vi.fn(() => Promise.resolve())

    constructor() {
      livekit.rooms.push(this as unknown as FakeRoomHandle)
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      const set = this.handlers.get(event) ?? new Set<(...args: unknown[]) => void>()
      set.add(handler)
      this.handlers.set(event, set)
      return this
    }

    off(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.get(event)?.delete(handler)
      return this
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args)
    }
  }

  return { ...actual, Room: FakeRoom }
})

/**
 * 오디오 트랙 대역. `attach()`(인자 없음)의 실제 계약을 흉내낸다 — 새 media element를 만들고
 * `autoplay`를 켜고, 스트림에 오디오 트랙이 있으므로 `muted`를 <b>해제</b>한 뒤 돌려준다
 * (livekit-client `attachToElement`: `element.muted = mediaStream.getAudioTracks().length === 0`).
 * 그래야 "페이지가 그 element를 음소거했는가"만 테스트의 관심사로 남는다.
 */
function audioTrack() {
  const elements: HTMLMediaElement[] = []
  return Object.assign(Object.create(RemoteAudioTrack.prototype) as RemoteAudioTrack, {
    attach: vi.fn(() => {
      const element = document.createElement('audio')
      element.autoplay = true
      element.muted = false
      elements.push(element)
      return element
    }),
    detach: vi.fn(() => elements.splice(0, elements.length)),
  })
}

function videoTrack() {
  return Object.assign(Object.create(RemoteVideoTrack.prototype) as RemoteVideoTrack, {
    attach: vi.fn((element?: HTMLMediaElement) => element ?? document.createElement('video')),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
  })
}

function publication(source: Track.Source) {
  return { source } as RemoteTrackPublication
}

async function renderStage() {
  const view = render(
    <MemoryRouter initialEntries={['/egress/stage?url=wss%3A%2F%2Flivekit.test&token=tok']}>
      <Routes>
        <Route path="/egress/stage" element={<EgressStagePage />} />
      </Routes>
    </MemoryRouter>,
  )

  const room = livekit.rooms.at(-1)
  expect(room, 'Room이 생성되지 않았습니다 — url·token 파싱을 확인하세요').toBeDefined()
  // connect().then(...)까지 흘러간 뒤부터가 관찰 대상이다. 대기 조건은 오디오와 무관한 기존 계약
  // (START_RECORDING)으로 잡는다 — 오디오 동작을 대기 조건에 섞으면 오디오가 빠졌을 때 모든
  // 테스트가 헬퍼 타임아웃으로 뭉개져 어디가 깨졌는지 알 수 없다.
  await waitFor(() => expect(console.log).toHaveBeenCalledWith('START_RECORDING'))

  // 싱크 조회는 지연시킨다. 헬퍼에서 단정하면 오디오가 빠졌을 때 비디오 테스트까지 같은 이유로
  // 무너져, 비디오 회귀를 실제로 검사하고 있는지 알 수 없게 된다.
  const requireAudioSink = () => {
    const sink = view.container.querySelector('.egress-stage__audio')
    expect(sink, '오디오 element가 살 싱크 컨테이너가 없습니다').not.toBeNull()
    return sink as HTMLElement
  }

  return {
    ...view,
    room: room as FakeRoomHandle,
    requireAudioSink,
    subscribe(track: RemoteAudioTrack | RemoteVideoTrack, source: Track.Source) {
      act(() => {
        room?.emit(RoomEvent.TrackSubscribed, track, publication(source))
      })
    },
    unsubscribe(track: RemoteAudioTrack | RemoteVideoTrack, source: Track.Source) {
      act(() => {
        room?.emit(RoomEvent.TrackUnsubscribed, track, publication(source))
      })
    },
    playedAudio() {
      return [...requireAudioSink().querySelectorAll('audio')]
    },
  }
}

beforeEach(() => {
  livekit.rooms.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Egress 합성 페이지의 오디오 재생', () => {
  it('강사 마이크 오디오를 실제로 재생한다 — attach하지 않으면 녹화가 무음이 된다', async () => {
    const stage = await renderStage()
    const microphone = audioTrack()

    stage.subscribe(microphone, Track.Source.Microphone)

    expect(microphone.attach).toHaveBeenCalled()
    expect(stage.playedAudio()).toHaveLength(1)
  })

  it('화면공유 오디오도 재생한다 — 강사가 공유한 탭 소리를 수강생도 들어야 한다', async () => {
    const stage = await renderStage()
    const shareAudio = audioTrack()

    stage.subscribe(shareAudio, Track.Source.ScreenShareAudio)

    expect(shareAudio.attach).toHaveBeenCalled()
    expect(stage.playedAudio()).toHaveLength(1)
  })

  it('마이크와 화면공유 오디오를 동시에 재생한다 — 하나만 지원하면 나머지가 사라진다', async () => {
    const stage = await renderStage()

    stage.subscribe(audioTrack(), Track.Source.Microphone)
    stage.subscribe(audioTrack(), Track.Source.ScreenShareAudio)

    expect(stage.playedAudio()).toHaveLength(2)
  })

  it.each([
    ['마이크', Track.Source.Microphone],
    ['화면공유 오디오', Track.Source.ScreenShareAudio],
  ] as const)('%s element를 음소거하지 않고 autoplay로 재생한다', async (_label, source) => {
    const stage = await renderStage()

    stage.subscribe(audioTrack(), source)

    for (const element of stage.playedAudio()) {
      // 이 두 줄이 이 버그의 본질이다. muted면 pulseaudio가 캡처할 소리가 없다.
      expect(element.muted, '오디오 element가 음소거되면 합성 결과가 무음이다').toBe(false)
      expect(element.hasAttribute('muted')).toBe(false)
      expect(element.autoplay, '자동재생이 없으면 제스처가 없는 헤드리스 Chrome에서 재생되지 않는다')
        .toBe(true)
    }
  })

  it('오디오 싱크는 합성 프레임에 보이지 않는다 — 렌더 결과가 그대로 HLS다', async () => {
    const stage = await renderStage()
    stage.subscribe(audioTrack(), Track.Source.Microphone)

    // 화면에서 감추는 것은 CSS(.egress-stage__audio { display: none })가 하고, 여기서는 그 싱크가
    // 레이아웃을 차지하는 마크업(예: 대체 텍스트·컨트롤)을 들이지 않았는지만 본다.
    const sink = stage.requireAudioSink()
    expect(sink).toHaveAttribute('aria-hidden', 'true')
    expect(sink.textContent).toBe('')
    for (const element of stage.playedAudio()) {
      expect(element.controls).toBe(false)
    }
  })

  it('구독이 끊기면 오디오 element를 걷어낸다 — 남으면 재연결 때 소리가 겹친다', async () => {
    const stage = await renderStage()
    const microphone = audioTrack()

    stage.subscribe(microphone, Track.Source.Microphone)
    expect(stage.playedAudio()).toHaveLength(1)

    stage.unsubscribe(microphone, Track.Source.Microphone)

    expect(microphone.detach).toHaveBeenCalled()
    expect(stage.playedAudio()).toHaveLength(0)
  })
})

/**
 * 헤드리스 Chrome은 `--autoplay-policy=no-user-gesture-required`로 뜨므로 보통 첫 attach에서 바로
 * 재생된다. 그 전제가 깨졌을 때 <b>조용히 무음으로 녹화되는 것</b>이 최악이라, 복구 시도와 상한을
 * 함께 잠근다.
 */
describe('오디오 자동재생이 막혔을 때', () => {
  it('startAudio()로 음소거 해제·AudioContext resume을 다시 시도한다', async () => {
    const stage = await renderStage()
    const callsBefore = stage.room.startAudio.mock.calls.length

    stage.room.canPlaybackAudio = false
    act(() => {
      stage.room.emit(RoomEvent.AudioPlaybackStatusChanged, false)
    })

    expect(stage.room.startAudio.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('재생이 되고 있으면 startAudio()를 다시 부르지 않는다', async () => {
    const stage = await renderStage()
    const callsBefore = stage.room.startAudio.mock.calls.length

    stage.room.canPlaybackAudio = true
    act(() => {
      stage.room.emit(RoomEvent.AudioPlaybackStatusChanged, true)
    })

    expect(stage.room.startAudio.mock.calls.length).toBe(callsBefore)
  })

  it('끝내 막히면 재시도를 멈추고 원인을 콘솔에 남긴다 — Egress가 보는 유일한 창구다', async () => {
    const stage = await renderStage()
    const callsBefore = stage.room.startAudio.mock.calls.length

    stage.room.canPlaybackAudio = false
    for (let i = 0; i < 20; i += 1) {
      act(() => {
        stage.room.emit(RoomEvent.AudioPlaybackStatusChanged, false)
      })
    }

    const retries = stage.room.startAudio.mock.calls.length - callsBefore
    expect(retries).toBeGreaterThan(0)
    expect(retries, '무한 재시도는 Egress CPU를 갉아먹는다').toBeLessThan(20)
    expect(console.error).toHaveBeenCalled()
  })
})

/**
 * 오디오를 별도 element로 빼는 대신 `<video>`의 muted를 벗기는 수정은 하지 않았다. 비디오 트랙에는
 * 오디오가 실려 있지 않아(LiveKit은 오디오를 별도 트랙으로 퍼블리시한다) 음소거해도 소리가 사라지지
 * 않고, 반대로 muted가 없으면 자동재생 정책에 막혀 <b>화면까지</b> 멈출 수 있다.
 */
describe('비디오 트랙 동작은 그대로다', () => {
  it('화면공유·카메라를 각자의 video element에 붙인다', async () => {
    const stage = await renderStage()
    const screen = videoTrack()
    const camera = videoTrack()

    stage.subscribe(screen, Track.Source.ScreenShare)
    stage.subscribe(camera, Track.Source.Camera)

    expect(screen.attach).toHaveBeenCalledWith(stage.container.querySelector('.egress-stage__screen'))
    expect(camera.attach).toHaveBeenCalledWith(
      stage.container.querySelector('.egress-stage__camera'),
    )
    expect(stage.container.querySelector('.egress-stage__screen')).not.toHaveClass('is-hidden')
    expect(stage.container.querySelector('.egress-stage__camera')).not.toHaveClass('is-hidden')
  })

  it('video는 muted를 유지한다 — 오디오가 막혀도 그림은 계속 나가야 한다', async () => {
    const stage = await renderStage()

    for (const element of stage.container.querySelectorAll('video')) {
      expect(element.muted).toBe(true)
      expect(element.autoplay).toBe(true)
    }
  })

  it('화면공유가 없으면 카메라가 무대를 통째로 쓴다', async () => {
    const stage = await renderStage()

    stage.subscribe(videoTrack(), Track.Source.Camera)

    expect(stage.container.querySelector('.egress-stage__camera')).toHaveClass('is-stage')
  })

  it('화면공유가 붙으면 카메라는 오버레이로 돌아간다', async () => {
    const stage = await renderStage()

    stage.subscribe(videoTrack(), Track.Source.ScreenShare)
    stage.subscribe(videoTrack(), Track.Source.Camera)

    expect(stage.container.querySelector('.egress-stage__camera')).not.toHaveClass('is-stage')
  })

  /**
   * 뒤집기는 <b>여기서 정해지면 되돌릴 수 없다</b>. 이 캔버스가 그대로 HLS·녹화로 나가므로,
   * 반전된 채 나가면 VOD에 영구히 남는다.
   *
   * <p>웹캠은 거울이 맞고(강사가 자기 얼굴을 거울로 본다) 파일 송출은 아니다 — 어느 쪽인지는
   * 강사 화면이 participant metadata로 알려 준다(ADR-0100).
   */
  function instructorWith(metadata: string | undefined) {
    return {
      metadata,
      getTrackPublication: (source: Track.Source) =>
        (source === Track.Source.Camera ? publication(source) : undefined),
    }
  }

  /**
   * <b>음소거는 검은 상자를 남기던 버그였다.</b> `setCameraEnabled(false)`는 트랙을 걷어내지 않고
   * mute한다(livekit-client 문서). 그래서 `TrackUnsubscribed`가 오지 않고, 그 이벤트만 듣던 이
   * 페이지는 element를 그대로 두어 <b>프레임이 끊긴 video가 검은 사각형으로 합성에 실렸다</b> —
   * 강사는 카메라를 껐는데 수강생 화면에는 검은 상자가 남는다.
   */
  it('카메라를 음소거하면 합성에서 내린다', async () => {
    const stage = await renderStage()
    stage.subscribe(videoTrack(), Track.Source.Camera)
    expect(stage.container.querySelector('.egress-stage__camera')).not.toHaveClass('is-hidden')

    act(() => {
      stage.room.emit(RoomEvent.TrackMuted, { source: Track.Source.Camera, isMuted: true, track: {} })
    })

    expect(stage.container.querySelector('.egress-stage__camera')).toHaveClass('is-hidden')
  })

  it('음소거를 풀면 다시 올린다', async () => {
    const stage = await renderStage()
    stage.subscribe(videoTrack(), Track.Source.Camera)
    act(() => {
      stage.room.emit(RoomEvent.TrackMuted, { source: Track.Source.Camera, isMuted: true, track: {} })
    })

    act(() => {
      stage.room.emit(RoomEvent.TrackUnmuted, { source: Track.Source.Camera, isMuted: false, track: {} })
    })

    expect(stage.container.querySelector('.egress-stage__camera')).not.toHaveClass('is-hidden')
  })

  it('metadata가 없으면 거울로 그린다 — 지금까지의 동작이 그것이다', async () => {
    const stage = await renderStage()

    stage.subscribe(videoTrack(), Track.Source.Camera)

    expect(stage.container.querySelector('.egress-stage__camera')).toHaveClass('is-mirrored')
  })

  it('파일 송출이라고 알려 오면 뒤집지 않는다', async () => {
    const stage = await renderStage()
    stage.room.remoteParticipants.set('instructor', instructorWith(
      JSON.stringify({ cameraOverlay: { visible: true, mirrored: false, x: 0.7, y: 0.6, w: 0.25 } }),
    ))

    act(() => { stage.room.emit(RoomEvent.ParticipantMetadataChanged) })
    stage.subscribe(videoTrack(), Track.Source.Camera)

    expect(stage.container.querySelector('.egress-stage__camera')).not.toHaveClass('is-mirrored')
  })

  it('웹캠으로 돌아오면 다시 뒤집는다', async () => {
    const stage = await renderStage()
    stage.room.remoteParticipants.set('instructor', instructorWith(
      JSON.stringify({ cameraOverlay: { visible: true, mirrored: true, x: 0.7, y: 0.6, w: 0.25 } }),
    ))

    act(() => { stage.room.emit(RoomEvent.ParticipantMetadataChanged) })
    stage.subscribe(videoTrack(), Track.Source.Camera)

    expect(stage.container.querySelector('.egress-stage__camera')).toHaveClass('is-mirrored')
  })
})
