import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InstructorLiveMediaProvider, {
  useInstructorLiveKit,
} from '@/features/live-session/InstructorLiveMediaProvider'
import { ANNOTATION_TOPIC, decodeAnnotationOp, type AnnotationOp } from '@/features/live-session/annotation'

const liveKit = vi.hoisted(() => {
  const localParticipant = {
    isCameraEnabled: false,
    isMicrophoneEnabled: false,
    isScreenShareEnabled: false,
    getTrackPublication: vi.fn(),
    setCameraEnabled: vi.fn(async (enabled: boolean) => {
      localParticipant.isCameraEnabled = enabled
    }),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      localParticipant.isMicrophoneEnabled = enabled
    }),
    setScreenShareEnabled: vi.fn(async (enabled: boolean) => {
      localParticipant.isScreenShareEnabled = enabled
    }),
    publishData: vi.fn<(payload: Uint8Array, options?: { topic?: string }) => Promise<void>>(
      async () => {},
    ),
    setMetadata: vi.fn(async () => {}),
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

  return { localParticipant, room }
})

const liveSessionApi = vi.hoisted(() => ({
  preparePreflightRoom: vi.fn(),
  getInstructorLiveToken: vi.fn(),
}))

vi.mock('@/shared/config/runtime', () => ({
  isMockApiEnabled: false,
  isTestMode: true,
}))

vi.mock('@/features/live-session/liveSessionService', () => liveSessionApi)

const annotationSink = vi.hoisted(() => ({ push: vi.fn(), flush: vi.fn(), stop: vi.fn(), pending: () => 0 }))
const annotationApi = vi.hoisted(() => ({
  fetchAnnotationDocument: vi.fn(),
  createAnnotationOpSink: vi.fn(),
  emptyRestoredAnnotation: vi.fn(),
}))
vi.mock('@/features/live-session/annotationPersistence', () => annotationApi)

vi.mock('livekit-client', () => ({
  LocalVideoTrack: class LocalVideoTrack {},
  MediaDeviceFailure: {
    PermissionDenied: 'PermissionDenied',
    NotFound: 'NotFound',
    DeviceInUse: 'DeviceInUse',
    getFailure: vi.fn(),
  },
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
    Reconnecting: 'Reconnecting',
    Reconnected: 'Reconnected',
    Disconnected: 'Disconnected',
    MediaDevicesError: 'MediaDevicesError',
    LocalTrackPublished: 'LocalTrackPublished',
    LocalTrackUnpublished: 'LocalTrackUnpublished',
    TrackMuted: 'TrackMuted',
    TrackUnmuted: 'TrackUnmuted',
  },
  Track: {
    Source: {
      Camera: 'Camera',
      ScreenShare: 'ScreenShare',
    },
  },
}))

/** 테스트에서 provider의 publish 함수를 직접 부르기 위한 통로. */
let publisherRef: ReturnType<typeof useInstructorLiveKit> | null = null

function ProviderStateProbe() {
  const publisher = useInstructorLiveKit()
  publisherRef = publisher
  return (
    <output>
      {[
        publisher.sessionId,
        publisher.connectionState,
        String(publisher.microphoneEnabled),
        String(publisher.cameraEnabled),
        String(publisher.canControl),
      ].join('|')}
    </output>
  )
}

describe('InstructorLiveMediaProvider', () => {
  beforeEach(() => {
    liveKit.localParticipant.isCameraEnabled = false
    liveKit.localParticipant.isMicrophoneEnabled = false
    liveKit.localParticipant.isScreenShareEnabled = false
    liveKit.room.connect.mockResolvedValue(undefined)
    liveKit.room.disconnect.mockResolvedValue(undefined)
    liveSessionApi.preparePreflightRoom.mockResolvedValue({
      sessionId: 'session-1',
      roomName: 'session-session-1',
      roomSid: 'RM_1',
    })
    liveSessionApi.getInstructorLiveToken.mockResolvedValue({
      token: 'publisher-token',
      wsUrl: 'wss://live.example.test',
    })
    liveKit.localParticipant.publishData.mockClear()
    annotationSink.push.mockClear()
    annotationApi.createAnnotationOpSink.mockReturnValue(annotationSink)
    annotationApi.fetchAnnotationDocument.mockResolvedValue({
      document: { revision: 0, elements: [] },
      nextRevision: 1,
    })
  })

  /** 판서 op만 골라 디코드한다. 레이저는 다른 topic으로 나간다. */
  function publishedAnnotationOps(): AnnotationOp[] {
    return liveKit.localParticipant.publishData.mock.calls
      .filter(([, options]) => (options as { topic?: string } | undefined)?.topic === ANNOTATION_TOPIC)
      .map(([payload]) => decodeAnnotationOp(payload as Uint8Array))
      .filter((op): op is AnnotationOp => op !== null)
  }

  it('강사 전용 토큰을 받아 연결하고 Provider 상태를 소비자에게 전달한다', async () => {
    render(
      <MemoryRouter initialEntries={['/instructor/live-sessions/session-1/preflight']}>
        <Routes>
          <Route
            path="/instructor/live-sessions/:sessionId/preflight"
            element={(
              <InstructorLiveMediaProvider>
                <ProviderStateProbe />
              </InstructorLiveMediaProvider>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'session-1|connected|true|true|true',
      )
    })

    expect(liveSessionApi.preparePreflightRoom).toHaveBeenCalledWith('session-1')
    expect(liveSessionApi.getInstructorLiveToken).toHaveBeenCalledWith('session-1')
    expect(liveSessionApi.preparePreflightRoom.mock.invocationCallOrder[0])
      .toBeLessThan(liveSessionApi.getInstructorLiveToken.mock.invocationCallOrder[0])
    expect(liveKit.room.connect).toHaveBeenCalledWith(
      'wss://live.example.test',
      'publisher-token',
      { autoSubscribe: false },
    )
  })

  /**
   * 판서 영속화(ADR-0051). 강사가 새로고침하면 두 가지가 어긋난다 — 강사 화면만 비고, op 번호가
   * 1로 돌아간다. 저장된 문서를 불러와 <b>스냅샷으로</b> 다시 내보내는 것이 둘 다 푼다.
   */
  describe('저장된 판서 복원', () => {
    function renderProvider() {
      return render(
        <MemoryRouter initialEntries={['/instructor/live-sessions/session-1/preflight']}>
          <Routes>
            <Route
              path="/instructor/live-sessions/:sessionId/preflight"
              element={(
                <InstructorLiveMediaProvider>
                  <ProviderStateProbe />
                </InstructorLiveMediaProvider>
              )}
            />
          </Routes>
        </MemoryRouter>,
      )
    }

    /**
     * `clear`나 `upsert`로는 안 된다 — 그것들은 revision 검사를 받아 Egress가 버린다. 스냅샷만
     * 검사를 건너뛰므로 복구 경로가 될 수 있다.
     */
    it('접속하면 빈 스냅샷으로 revision 기준점을 잡는다', async () => {
      const elements = [{ id: 'a', type: 'freedraw', version: 3 }]
      annotationApi.fetchAnnotationDocument.mockResolvedValue({
        document: { revision: 47, elements },
        nextRevision: 48,
      })

      renderProvider()

      // 복원한 판서 자체는 여기서 내보내지 않는다 — 새로고침 직후 판서는 꺼진 상태라, 여기서 보내면
      // 강사에게는 안 보이는 판서가 수강생 화면에만 뜬다. 내보내는 일은 판서를 켤 때 레이어가 한다.
      await waitFor(() => {
        expect(publishedAnnotationOps()).toContainEqual({ type: 'snapshot', revision: 48, elements: [] })
      })
    })

    /**
     * `clear`는 문서를 지우는 편집이 아니라 판서를 껐을 때 수강생 화면에서 감추라는 <b>표시 상태</b>다.
     * 강사의 문서는 그대로 남아 다시 켜면 돌아오는데, 저장해 버리면 서버 쪽 문서만 비어 새로고침했을 때
     * 판서가 통째로 사라진다.
     */
    it('clear는 서버에 남기지 않는다 — 지우는 것이 아니라 감추는 것이다', async () => {
      const { getByRole } = renderProvider()
      await waitFor(() => { expect(getByRole('status')).toHaveTextContent('connected') })
      await waitFor(() => { expect(annotationSink.push).toHaveBeenCalled() })
      annotationSink.push.mockClear()

      publisherRef!.publishAnnotation({ type: 'clear' })
      publisherRef!.publishAnnotation({ type: 'upsert', elements: [{ id: 'a', type: 'freedraw', version: 1 }] })

      const kinds = annotationSink.push.mock.calls.map(([op]) => (op as AnnotationOp).type)
      expect(kinds).toEqual(['upsert'])
      // 라이브 전달에는 그대로 나간다 — 안 보내면 강사만 껐다고 믿고 수강생·녹화에는 남는다.
      expect(publishedAnnotationOps().map((op) => op.type)).toContain('clear')
    })

    /**
     * 새로고침하면 브라우저의 카운터가 0으로 돌아간다. 서버가 알려 준 번호에서 이어가지 않으면 새로
     * 그린 획이 전부 "이미 본 op"로 버려져 <b>수강생에게 영영 나타나지 않는다</b> — 강사 화면에는
     * 그려지므로 눈치채기 어렵다.
     */
    it('서버가 알려 준 번호부터 이어서 채번한다', async () => {
      annotationApi.fetchAnnotationDocument.mockResolvedValue({
        document: { revision: 47, elements: [] },
        nextRevision: 48,
      })

      const { getByRole } = renderProvider()
      await waitFor(() => { expect(getByRole('status')).toHaveTextContent('connected') })
      await waitFor(() => { expect(publishedAnnotationOps().length).toBeGreaterThan(0) })

      expect(publishedAnnotationOps()[0].revision).toBe(48)
    })

    /** 복원 스냅샷도 기록에 남긴다 — 다음 복원이 이 지점부터 접으면 되므로 갈수록 빨라진다. */
    it('복원 스냅샷을 서버 기록에도 남긴다', async () => {
      annotationApi.fetchAnnotationDocument.mockResolvedValue({
        document: { revision: 47, elements: [] },
        nextRevision: 48,
      })

      renderProvider()

      await waitFor(() => {
        expect(annotationSink.push).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'snapshot', revision: 48 }),
        )
      })
    })
  })
})
