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
   * 운영에서 사전 점검이 "Requested device not found"를 띄우고 <b>연결 실패</b>로 물러났다.
   * 방에는 이미 들어와 있었고, 실제 원인은 그 컴퓨터에 마이크가 없다는 것이었다.
   */
  describe('장치 실패는 연결 실패가 아니다', () => {
    function domError(name: string, message = '') {
      const error = new Error(message)
      error.name = name
      return error
    }

    /** 권한 조회와 장치 목록을 원하는 상태로 세운다. jsdom에는 둘 다 없다. */
    function installBrowserMedia({ permission, hasMicrophone = true }: {
      permission?: PermissionState
      hasMicrophone?: boolean
    }) {
      const permissionListeners: Array<() => void> = []
      const status = {
        state: permission ?? 'granted',
        addEventListener: (_: string, handler: () => void) => { permissionListeners.push(handler) },
        removeEventListener: () => { permissionListeners.splice(0, permissionListeners.length) },
      }
      const deviceListeners: Array<() => void> = []
      const originals = {
        permissions: navigator.permissions,
        mediaDevices: navigator.mediaDevices,
      }
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: permission === undefined ? undefined : { query: vi.fn().mockResolvedValue(status) },
      })
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          enumerateDevices: vi.fn().mockResolvedValue(
            hasMicrophone ? [{ kind: 'audioinput' }, { kind: 'videoinput' }] : [{ kind: 'videoinput' }],
          ),
          addEventListener: (_: string, handler: () => void) => { deviceListeners.push(handler) },
          /*
           * 실제 API처럼 <b>해당 핸들러만</b> 뺀다. 전부 지우면 devicechange를 듣는 다른 구독자가
           * (장치 목록 갱신 등) 재등록될 때 마이크 재시도 리스너까지 함께 사라져, 이 화면과
           * 무관한 변경이 엉뚱한 테스트를 깨뜨린다.
           */
          removeEventListener: (_: string, handler: () => void) => {
            const index = deviceListeners.indexOf(handler)
            if (index >= 0) deviceListeners.splice(index, 1)
          },
        },
      })

      return {
        /** 사이트 설정이 바뀐 것처럼. */
        changePermission(next: PermissionState) {
          status.state = next
          permissionListeners.forEach((handler) => handler())
        },
        /** 마이크를 꽂은 것처럼. */
        plugDevice() { deviceListeners.forEach((handler) => handler()) },
        restore() {
          Object.defineProperty(navigator, 'permissions', { configurable: true, value: originals.permissions })
          Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originals.mediaDevices })
        },
      }
    }

    it('마이크가 없어도 방을 끊지 않고, 원인을 장치로 말한다', async () => {
      const browser = installBrowserMedia({ permission: 'granted', hasMicrophone: false })
      renderProvider()

      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('no-device') })
      // 예전에는 여기서 connectionState가 'error'가 되고 방이 끊겼다.
      expect(publisherRef!.connectionState).toBe('connected')
      expect(publisherRef!.errorMessage).toBeUndefined()
      // 조작이 잠기면 마이크를 꽂고도 마이크만 다시 켤 수가 없다.
      expect(publisherRef!.canControl).toBe(true)
      expect(publisherRef!.mediaFailure?.title).toBe('마이크를 찾지 못했습니다')
      browser.restore()
    })

    /**
     * 운영에서 난 그대로. 장치 목록을 미리 못 읽는 브라우저에서는 <b>요청이 던지는 것</b>이
     * 유일한 신호다 — 그 오류가 바깥 catch로 새어 나가 방을 끊고 "연결 실패"를 띄웠다.
     */
    it('던져진 오류가 방을 끊지 않는다 — 장치 목록을 못 읽는 브라우저에서도', async () => {
      liveKit.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
        domError('NotFoundError', 'Requested device not found'),
      )
      renderProvider()

      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('no-device') })
      expect(publisherRef!.connectionState).toBe('connected')
      expect(publisherRef!.canControl).toBe(true)
      expect(liveKit.room.disconnect).not.toHaveBeenCalled()
      // 강사 화면에 영어 원문이 남지 않는다.
      const shown = `${publisherRef!.mediaFailure?.title}${publisherRef!.mediaFailure?.detail}`
      expect(shown).not.toContain('Requested device not found')
    })

    it('권한이 차단이면 요청조차 하지 않는다 — 조용히 거절당하면 멈춘 것처럼 보인다', async () => {
      const browser = installBrowserMedia({ permission: 'denied' })
      liveKit.localParticipant.setMicrophoneEnabled.mockClear()
      renderProvider()

      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('blocked') })
      expect(liveKit.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
      expect(publisherRef!.mediaFailure?.retryable).toBe(false)
      expect(publisherRef!.microphonePermission).toBe('denied')
      browser.restore()
    })

    it('브라우저가 던진 오류도 우리 말로 옮긴다', async () => {
      const browser = installBrowserMedia({ permission: 'granted' })
      liveKit.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
        domError('NotReadableError', 'Could not start audio source'),
      )
      renderProvider()

      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('in-use') })
      expect(publisherRef!.connectionState).toBe('connected')
      expect(publisherRef!.mediaFailure?.detail).not.toContain('Could not start audio source')
      browser.restore()
    })

    it('다시 시도는 마이크만 다시 연다 — 방은 다시 붙지 않는다', async () => {
      const browser = installBrowserMedia({ permission: 'granted', hasMicrophone: false })
      liveKit.room.connect.mockClear()
      renderProvider()
      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('no-device') })

      liveKit.localParticipant.setMicrophoneEnabled.mockClear()
      const recovered = installBrowserMedia({ permission: 'granted', hasMicrophone: true })
      publisherRef!.retryMedia()

      await waitFor(() => { expect(liveKit.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true) })
      await waitFor(() => { expect(publisherRef!.mediaFailure).toBeUndefined() })
      expect(liveKit.room.connect).toHaveBeenCalledTimes(1)
      recovered.restore()
      browser.restore()
    })

    it('마이크를 꽂으면 강사가 아무것도 안 해도 다시 시도한다', async () => {
      const browser = installBrowserMedia({ permission: 'granted', hasMicrophone: false })
      renderProvider()
      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('no-device') })

      liveKit.localParticipant.setMicrophoneEnabled.mockClear()
      // 장치가 생겼다고 알린다. enumerateDevices가 이제 마이크를 준다.
      ;(navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>)
        .mockResolvedValue([{ kind: 'audioinput' }, { kind: 'videoinput' }])
      browser.plugDevice()

      await waitFor(() => { expect(liveKit.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true) })
      browser.restore()
    })

    /** "이번만 허용"이 끝나면 브라우저가 마이크를 끊는다. 아무 말이 없으면 강사는 그대로 강의한다. */
    it('송출 중에 허용이 걷히면 알린다', async () => {
      const browser = installBrowserMedia({ permission: 'granted' })
      renderProvider()
      await waitFor(() => { expect(publisherRef!.microphoneEnabled).toBe(true) })

      browser.changePermission('prompt')

      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('dismissed') })
      expect(publisherRef!.mediaFailure?.detail).toContain('이번만 허용')
      expect(publisherRef!.connectionState).toBe('connected')
      browser.restore()
    })

    it('허용으로 바뀌면 스스로 회복한다', async () => {
      const browser = installBrowserMedia({ permission: 'denied' })
      renderProvider()
      await waitFor(() => { expect(publisherRef!.mediaFailure?.cause).toBe('blocked') })

      liveKit.localParticipant.setMicrophoneEnabled.mockClear()
      browser.changePermission('granted')

      await waitFor(() => { expect(liveKit.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true) })
      await waitFor(() => { expect(publisherRef!.microphonePermission).toBe('granted') })
      browser.restore()
    })
  })

  describe('저장된 판서 복원', () => {
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
    /**
     * 복원은 <b>마지막 스냅샷부터</b> 접는다. 그래서 문서를 담지 않은 op가 그 자리에 앉으면 그 앞의
     * 판서가 통째로 사라진다. 전달에만 쓰는 op는 남기지 않는다.
     *
     * <ul>
     *   <li>`clear` — 지우기가 아니라 판서를 껐을 때 감추라는 표시 상태다. 강사 문서는 그대로 남는다.</li>
     *   <li>빈 스냅샷 — revision 기준점을 잡는 장치다. 페이지를 열 때마다 하나씩 쌓인다.</li>
     * </ul>
     *
     * <p>문서가 실제로 비는 것은 `delete`로 기록되므로(diffAnnotationElements) 빈 스냅샷을 남길 필요가 없다.
     */
    it('전달에만 쓰는 op는 서버에 남기지 않는다 — clear와 빈 스냅샷', async () => {
      const { getByRole } = renderProvider()
      await waitFor(() => { expect(getByRole('status')).toHaveTextContent('connected') })
      // 접속하며 나가는 기준점 스냅샷이 이미 전달됐다.
      await waitFor(() => { expect(publishedAnnotationOps().length).toBeGreaterThan(0) })

      // 기준점(빈 스냅샷)은 전달만 되고 기록되지 않는다.
      expect(annotationSink.push).not.toHaveBeenCalled()
      expect(publishedAnnotationOps()).toContainEqual(
        expect.objectContaining({ type: 'snapshot', elements: [] }),
      )

      publisherRef!.publishAnnotation({ type: 'clear' })
      publisherRef!.publishAnnotation({ type: 'snapshot', elements: [] })
      publisherRef!.publishAnnotation({ type: 'delete', ids: ['a'] })
      publisherRef!.publishAnnotation({ type: 'upsert', elements: [{ id: 'a', type: 'freedraw', version: 1 }] })

      const kinds = annotationSink.push.mock.calls.map(([op]) => (op as AnnotationOp).type)
      expect(kinds).toEqual(['delete', 'upsert'])
      // 라이브 전달에는 그대로 나간다 — 안 보내면 강사만 껐다고 믿고 수강생·녹화에는 남는다.
      expect(publishedAnnotationOps().map((op) => op.type)).toContain('clear')
    })

    /** 내용이 있는 스냅샷은 남긴다 — 다음 복원이 이 지점부터 접으면 되므로 갈수록 빨라진다. */
    it('내용이 있는 스냅샷은 남긴다', async () => {
      const { getByRole } = renderProvider()
      await waitFor(() => { expect(getByRole('status')).toHaveTextContent('connected') })
      annotationSink.push.mockClear()

      publisherRef!.publishAnnotation({
        type: 'snapshot', elements: [{ id: 'a', type: 'freedraw', version: 1 }],
      })

      expect(annotationSink.push).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'snapshot' }),
      )
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
  })
  /**
   * 카메라 배치 발행(레이저와 같은 프레임 배치).
   *
   * <p>예전에는 `pointermove`마다 그대로 `setMetadata`를 불렀다. livekit-client는 서버가 <b>자기가
   * 보낸 문자열과 똑같은 값</b>을 되돌려줄 때만 resolve하고 5초 동안 50ms 간격으로 폴링하므로,
   * 드래그 중간값은 <b>구조적으로 절대 resolve되지 않고</b> 전부 timeout으로 떨어졌다. 그 경고가
   * 운영 콘솔에서 진짜 오류를 밀어냈다.
   */
  describe('카메라 배치 발행', () => {
    /** 프레임 하나를 실제로 흘려보낸다. rAF 뒤에 붙은 마이크로태스크까지 비운다. */
    const nextFrame = () => new Promise((resolve) => {
      requestAnimationFrame(() => { setTimeout(resolve, 0) })
    })

    const publishedOverlays = () => liveKit.localParticipant.setMetadata.mock.calls
      .map(([metadata]) => (JSON.parse(metadata) as {
        cameraOverlay: { x: number; y: number; w: number; mirrored: boolean }
      }).cameraOverlay)

    async function connected() {
      const view = renderProvider()
      await waitFor(() => { expect(view.getByRole('status')).toHaveTextContent('connected') })
      /*
       * <b>지우기 전에 한 프레임을 흘려보낸다.</b> 연결이 붙으면 재연결 복원 발행이 따로 돌고
       * (강사가 옮겨 둔 자리를 다시 싣는 효과), 화면 텍스트만 보고 바로 mockClear를 하면 그
       * 발행이 아직 안 나간 상태로 지워질 수 있다. 그러면 뒤늦게 나간 그 한 번이 아래의
       * "프레임당 한 번" 단언에 섞여 <b>두 번</b>으로 잡힌다.
       *
       * 로컬에서는 연결이 즉시 끝나 안 보이지만 CI 러너처럼 부하가 있으면 드러난다 —
       * 실제로 파이프라인 170350에서 이 단언이 그렇게 깨졌다.
       */
      await nextFrame()
      liveKit.localParticipant.setMetadata.mockClear()
      return view
    }

    it('드래그 중 여러 번 옮겨도 프레임당 한 번만 발행한다', async () => {
      await connected()

      publisherRef!.moveCameraOverlay({ x: 0.1 })
      publisherRef!.moveCameraOverlay({ x: 0.2 })
      publisherRef!.moveCameraOverlay({ x: 0.3 })
      // 아직 프레임이 오지 않았다 — 중간값은 시그널 채널로 나가지 않는다.
      expect(liveKit.localParticipant.setMetadata).not.toHaveBeenCalled()

      await nextFrame()
      expect(liveKit.localParticipant.setMetadata).toHaveBeenCalledTimes(1)
      expect(publishedOverlays()[0].x).toBeCloseTo(0.3)
    })

    /**
     * <b>이 파일에서 가장 중요한 단언이다.</b> 마지막 값이 버려지면 강사가 손을 뗀 자리와 합성
     * 화면의 카메라 자리가 갈린다 — 그리고 그 어긋남은 <b>강사 화면에서는 보이지 않는다</b>.
     */
    it('손을 뗀 마지막 값은 반드시 나간다', async () => {
      await connected()

      publisherRef!.moveCameraOverlay({ x: 0.1 })
      await nextFrame()
      // 프레임이 지난 뒤에 온 마지막 조작. 새 프레임을 잡아 이것도 내보내야 한다.
      publisherRef!.moveCameraOverlay({ x: 0.42 })
      await nextFrame()

      expect(publishedOverlays().at(-1)!.x).toBeCloseTo(0.42)
    })

    /**
     * 미리보기는 발행 결과를 기다리지 않는다. 실패했다고 되돌리면 강사가 옮긴 자리가 손 밑에서
     * 튀어 돌아간다 — 배치는 마지막 값이 이기므로 다음 조작이 알아서 맞춘다.
     */
    it('발행이 실패해도 미리보기는 되돌리지 않는다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await connected()
      liveKit.localParticipant.setMetadata.mockRejectedValueOnce(new Error('timed out'))

      publisherRef!.moveCameraOverlay({ x: 0.2 })
      await nextFrame()

      await waitFor(() => { expect(warn).toHaveBeenCalled() })
      await waitFor(() => { expect(publisherRef!.cameraOverlay.x).toBeCloseTo(0.2) })
      warn.mockRestore()
    })

    /** 한 번짜리 조작(뒤집기 토글)도 프레임 하나 뒤에 그대로 나간다. */
    it('뒤집기 토글도 발행된다', async () => {
      await connected()

      publisherRef!.moveCameraOverlay({ mirrored: false })
      await nextFrame()

      expect(publishedOverlays().at(-1)!.mirrored).toBe(false)
    })
  })
})
