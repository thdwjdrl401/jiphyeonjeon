import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InstructorLiveMediaProvider, {
  useInstructorLiveKit,
} from '@/features/live-session/InstructorLiveMediaProvider'

/**
 * 데모 송출이 <b>장치를 건드리지 않는가</b>(ADR-0100).
 *
 * <p>여기서 지키는 것 둘 다 조용히 실패하는 종류다.
 *
 * <ol>
 *   <li><b>`source`가 맞는가.</b> STT agent는 `SOURCE_MICROPHONE`인 오디오만 강사 발화로 본다.
 *       그냥 올리면 source가 `UNKNOWN`이 되고 <b>영상과 녹화는 멀쩡한데 자막만 영영 안 뜬다</b> —
 *       자막이 없으면 강의 노트도 AI 근거도 빈 채로 간다. 시연 직전에 발견하면 최악이다.</li>
 *   <li><b>진짜 카메라가 안 켜지는가.</b> `setCameraEnabled(true)`가 한 번이라도 불리면 LiveKit이
 *       장치를 열어 <b>발표자의 실제 방이 수강생 화면에 뜬다</b>.</li>
 * </ol>
 */
const liveKit = vi.hoisted(() => {
  const publications = new Map<string, { track: unknown; isMuted: boolean; mute: () => Promise<void>; unmute: () => Promise<void> }>()
  const localParticipant = {
    isCameraEnabled: false,
    isMicrophoneEnabled: false,
    isScreenShareEnabled: false,
    getTrackPublication: vi.fn((source: string) => publications.get(source)),
    setCameraEnabled: vi.fn(async (enabled: boolean) => { localParticipant.isCameraEnabled = enabled }),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => { localParticipant.isMicrophoneEnabled = enabled }),
    setScreenShareEnabled: vi.fn(async () => {}),
    publishTrack: vi.fn(async (track: unknown, options: { source: string }) => {
      publications.set(options.source, {
        track,
        isMuted: false,
        mute: async () => { publications.get(options.source)!.isMuted = true },
        unmute: async () => { publications.get(options.source)!.isMuted = false },
      })
      if (options.source === 'Camera') localParticipant.isCameraEnabled = true
      if (options.source === 'Microphone') localParticipant.isMicrophoneEnabled = true
    }),
    unpublishTrack: vi.fn(async () => {}),
    publishData: vi.fn(async () => {}),
    setMetadata: vi.fn<(metadata: string) => Promise<void>>(async () => {}),
    metadata: undefined as string | undefined,
  }
  const room = {
    localParticipant,
    state: 'connected',
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  room.on.mockImplementation(() => room)
  room.off.mockImplementation(() => room)
  return { localParticipant, room, publications }
})

const liveSessionApi = vi.hoisted(() => ({
  preparePreflightRoom: vi.fn(),
  getInstructorLiveToken: vi.fn(),
}))
const annotationSink = vi.hoisted(() => ({ push: vi.fn(), flush: vi.fn(), stop: vi.fn(), pending: () => 0 }))
const annotationApi = vi.hoisted(() => ({
  fetchAnnotationDocument: vi.fn(),
  createAnnotationOpSink: vi.fn(),
  emptyRestoredAnnotation: vi.fn(),
}))

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: true }))
vi.mock('@/features/live-session/liveSessionService', () => liveSessionApi)
vi.mock('@/features/live-session/annotationPersistence', () => annotationApi)
vi.mock('livekit-client', () => ({
  LocalVideoTrack: class LocalVideoTrack {},
  LocalAudioTrack: class LocalAudioTrack {},
  VideoPresets: {
    h1080: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 3_000_000 } },
    h720: { resolution: { width: 1280, height: 720 }, encoding: { maxBitrate: 1_700_000 } },
    h540: { resolution: { width: 960, height: 540 }, encoding: { maxBitrate: 1_000_000 } },
  },
  ScreenSharePresets: {
    h1080fps30: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 5_000_000 } },
    h1080fps15: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 2_500_000 } },
    h720fps30: { resolution: { width: 1280, height: 720 }, encoding: { maxBitrate: 3_000_000 } },
  },
  Room: vi.fn(() => liveKit.room),
  RoomEvent: {
    Reconnecting: 'Reconnecting', Reconnected: 'Reconnected', Disconnected: 'Disconnected',
    MediaDevicesError: 'MediaDevicesError', LocalTrackPublished: 'LocalTrackPublished',
    LocalTrackUnpublished: 'LocalTrackUnpublished', TrackMuted: 'TrackMuted',
    TrackUnmuted: 'TrackUnmuted', ParticipantConnected: 'ParticipantConnected',
  },
  Track: { Source: { Camera: 'Camera', ScreenShare: 'ScreenShare', Microphone: 'Microphone' } },
}))

let publisherRef: ReturnType<typeof useInstructorLiveKit> | null = null

function Probe() {
  const publisher = useInstructorLiveKit()
  publisherRef = publisher
  return <output>{[publisher.connectionState, String(publisher.demoPublish.armed), String(publisher.cameraEnabled)].join('|')}</output>
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={['/instructor/live-sessions/session-1/preflight']}>
      <Routes>
        <Route element={<InstructorLiveMediaProvider><Probe /></InstructorLiveMediaProvider>} path="/instructor/live-sessions/:sessionId/preflight" />
      </Routes>
    </MemoryRouter>,
  )
}

const videoTrack = { kind: 'video', readyState: 'live' }
const audioTrack = { kind: 'audio', readyState: 'live' }

let createElementSpy: { mockRestore: () => void } | null = null

function installFakeVideo(audio = true) {
  // 스파이 안에서 document.createElement를 다시 부르면 자기 자신을 부른다. 원본을 먼저 붙잡아 둔다.
  const original = document.createElement.bind(document)
  const element = {
    play: vi.fn(async () => {}),
    pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(),
    src: '', loop: false, playsInline: false,
    captureStream: () => ({
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => (audio ? [audioTrack] : []),
    }),
  }
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'video' ? element : original(tag)) as typeof document.createElement)
  return element
}

describe('데모 송출 배선', () => {
  beforeEach(() => {
    sessionStorage.clear()
    liveKit.publications.clear()
    liveKit.localParticipant.isCameraEnabled = false
    liveKit.localParticipant.isMicrophoneEnabled = false
    liveKit.localParticipant.setCameraEnabled.mockClear()
    liveKit.localParticipant.setMicrophoneEnabled.mockClear()
    liveKit.localParticipant.publishTrack.mockClear()
    liveKit.room.connect.mockResolvedValue(undefined)
    liveKit.room.disconnect.mockResolvedValue(undefined)
    liveSessionApi.preparePreflightRoom.mockResolvedValue({ sessionId: 'session-1', roomName: 'session-session-1', roomSid: 'RM_1' })
    liveSessionApi.getInstructorLiveToken.mockResolvedValue({ token: 't', wsUrl: 'wss://live.example.test' })
    annotationApi.createAnnotationOpSink.mockReturnValue(annotationSink)
    annotationApi.fetchAnnotationDocument.mockResolvedValue({ document: { revision: 0, elements: [] }, nextRevision: 1 })
    URL.createObjectURL = vi.fn(() => 'blob:demo')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    publisherRef?.stopDemoPublish()
    createElementSpy?.mockRestore()
    createElementSpy = null
  })

  it('마이크는 SOURCE_MICROPHONE으로, 카메라는 SOURCE_CAMERA로 올린다', async () => {
    installFakeVideo()
    renderProvider()
    await screen.findByText(/connected/)

    publisherRef!.startDemoPublish(new File(['x'], 'demo.mp4', { type: 'video/mp4' }))

    await waitFor(() => expect(liveKit.localParticipant.publishTrack).toHaveBeenCalledTimes(2))
    const sources = liveKit.localParticipant.publishTrack.mock.calls.map(([, options]) => options.source)
    // 이게 자막의 조건이다. Microphone이 아니면 영상은 나가는데 자막만 영영 안 뜬다.
    expect(sources).toEqual(['Camera', 'Microphone'])
  })

  it('데모로 무장하면 진짜 장치를 아예 열지 않는다', async () => {
    installFakeVideo()
    sessionStorage.setItem('liveclass.demoPublish.armed', '1')
    renderProvider()
    await screen.findByText(/connected/)

    // 무장 상태의 첫 연결에서 장치를 여는 호출이 하나라도 있으면 안 된다.
    expect(liveKit.localParticipant.setCameraEnabled).not.toHaveBeenCalledWith(true, expect.anything(), expect.anything())
    expect(liveKit.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
  })

  /**
   * 새로고침 재현. 무장 표시는 남고 파일은 사라진 상태다. 여기서 카메라로 되돌아가면 발표자의
   * 실제 방이 수강생 화면에 뜬다.
   */
  it('파일을 잃어도 카메라로 되돌아가지 않고 그렇다고 말한다', async () => {
    sessionStorage.setItem('liveclass.demoPublish.armed', '1')
    renderProvider()
    await screen.findByText(/connected/)

    await waitFor(() => expect(publisherRef!.mediaFailure?.title).toMatch(/데모 영상이 없습니다/))
    expect(liveKit.localParticipant.setCameraEnabled).not.toHaveBeenCalledWith(true, expect.anything(), expect.anything())
    expect(liveKit.localParticipant.publishTrack).not.toHaveBeenCalled()
  })

  it('데모 중 카메라를 끄면 음소거일 뿐 장치를 새로 열지 않는다', async () => {
    installFakeVideo()
    renderProvider()
    await screen.findByText(/connected/)
    publisherRef!.startDemoPublish(new File(['x'], 'demo.mp4', { type: 'video/mp4' }))
    await waitFor(() => expect(liveKit.publications.get('Camera')).toBeTruthy())
    liveKit.localParticipant.setCameraEnabled.mockClear()

    publisherRef!.toggleCamera()

    await waitFor(() => expect(liveKit.publications.get('Camera')!.isMuted).toBe(true))
    // 여기서 setCameraEnabled(true)가 불리면 발표자의 진짜 카메라가 켜진다.
    expect(liveKit.localParticipant.setCameraEnabled).not.toHaveBeenCalled()

    publisherRef!.toggleCamera()
    await waitFor(() => expect(liveKit.publications.get('Camera')!.isMuted).toBe(false))
    expect(liveKit.localParticipant.setCameraEnabled).not.toHaveBeenCalled()
  })

  /**
   * 뒤집기는 <b>강사 화면과 Egress가 같이</b> 알아야 한다. 강사 화면만 고치면 강사는 멀쩡해
   * 보이는데 수강생만 반전을 보고, 그 상태로 녹화돼 VOD에 영구히 남는다(ADR-0100).
   */
  it('데모를 켜면 "뒤집지 말라"를 metadata로 내보낸다', async () => {
    installFakeVideo()
    renderProvider()
    await screen.findByText(/connected/)

    publisherRef!.startDemoPublish(new File(['x'], 'demo.mp4', { type: 'video/mp4' }))

    await waitFor(() => expect(publisherRef!.cameraOverlay.mirrored).toBe(false))
    const written = liveKit.localParticipant.setMetadata.mock.calls.at(-1)?.[0]
    expect(JSON.parse(written ?? '{}').cameraOverlay.mirrored).toBe(false)
  })

  it('데모를 끄면 다시 거울로 돌아간다', async () => {
    installFakeVideo()
    renderProvider()
    await screen.findByText(/connected/)
    publisherRef!.startDemoPublish(new File(['x'], 'demo.mp4', { type: 'video/mp4' }))
    await waitFor(() => expect(publisherRef!.cameraOverlay.mirrored).toBe(false))

    publisherRef!.stopDemoPublish()

    // 되돌리지 않으면 웹캠으로 돌아온 강사가 자기 얼굴을 뒤집힌 채로 본다.
    await waitFor(() => expect(publisherRef!.cameraOverlay.mirrored).toBe(true))
  })

  it('데모를 끄면 트랙을 내리고 평소 장치로 돌아간다', async () => {
    installFakeVideo()
    renderProvider()
    await screen.findByText(/connected/)
    publisherRef!.startDemoPublish(new File(['x'], 'demo.mp4', { type: 'video/mp4' }))
    await waitFor(() => expect(liveKit.localParticipant.publishTrack).toHaveBeenCalledTimes(2))

    publisherRef!.stopDemoPublish()

    await waitFor(() => expect(publisherRef!.demoPublish.armed).toBe(false))
    expect(liveKit.localParticipant.unpublishTrack).toHaveBeenCalled()
    expect(sessionStorage.getItem('liveclass.demoPublish.armed')).toBeNull()
  })
})
