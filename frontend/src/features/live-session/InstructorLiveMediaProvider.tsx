import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Outlet, useParams } from 'react-router-dom'
import {
  LocalVideoTrack,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { getInstructorLiveToken, preparePreflightRoom } from './liveSessionService'
import {
  cameraPreset,
  loadPublishQuality,
  savePublishQuality,
  screenPreset,
  type PublishQuality,
} from './publishQuality'
import {
  DEFAULT_CAMERA_OVERLAY,
  clampOverlay,
  parseCameraOverlay,
  withCameraOverlay,
  type CameraOverlay,
} from './cameraOverlay'

export type InstructorLiveKitConnectionState =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'
  | 'mock'

type MediaControl = 'camera' | 'microphone' | 'screenShare'

interface InstructorLiveKitState {
  connectionState: InstructorLiveKitConnectionState
  cameraEnabled: boolean
  microphoneEnabled: boolean
  screenShareEnabled: boolean
  cameraTrack?: LocalVideoTrack
  screenShareTrack?: LocalVideoTrack
  errorMessage?: string
  mediaRevision: number
}

export interface InstructorLiveMedia extends InstructorLiveKitState {
  sessionId: string
  pendingControl: MediaControl | 'initial' | null
  canControl: boolean
  /** 강사가 고른 송출 품질. 켜져 있는 트랙에는 즉시 반영된다. */
  quality: PublishQuality
  changeQuality: (next: Partial<PublishQuality>) => void
  /** 합성 화면에서 카메라가 놓일 자리. 강사가 옮긴 그대로 수강생 녹화에 반영된다. */
  cameraOverlay: CameraOverlay
  moveCameraOverlay: (next: Partial<CameraOverlay>) => void
  /** 품질 변경으로 트랙을 다시 올리는 중. 이때는 선택을 잠근다. */
  applyingQuality: boolean
  retry: () => void
  toggleCamera: () => void
  toggleMicrophone: () => void
  toggleScreenShare: () => void
}

const initialState: InstructorLiveKitState = {
  connectionState: 'idle',
  cameraEnabled: false,
  microphoneEnabled: false,
  screenShareEnabled: false,
  mediaRevision: 0,
}

const InstructorLiveMediaContext = createContext<InstructorLiveMedia | null>(null)

function getLocalVideoTrack(room: Room, source: Track.Source) {
  const track = room.localParticipant.getTrackPublication(source)?.videoTrack
  return track instanceof LocalVideoTrack ? track : undefined
}

function describeMediaError(error: unknown) {
  const failure = MediaDeviceFailure.getFailure(error)
  if (failure === MediaDeviceFailure.PermissionDenied) return '카메라 또는 마이크 권한이 거부되었습니다. 브라우저 권한을 허용한 뒤 다시 시도해 주세요.'
  if (failure === MediaDeviceFailure.NotFound) return '사용 가능한 카메라 또는 마이크를 찾지 못했습니다.'
  if (failure === MediaDeviceFailure.DeviceInUse) return '카메라 또는 마이크를 다른 프로그램이 사용 중입니다.'
  return error instanceof Error ? error.message : '미디어 장치를 시작하지 못했습니다.'
}

function describeConnectionError(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : 'LiveKit 송출 서버에 연결하지 못했습니다.'
}

/**
 * 트랙을 올릴 때마다 품질을 명시한다. Room 생성 시의 publishDefaults만 믿으면, 강사가 도중에
 * 품질을 바꾼 뒤 카메라를 껐다 켰을 때 옛 기본값으로 되돌아간다.
 */
function cameraPublishArgs(quality: PublishQuality) {
  const preset = cameraPreset(quality)
  return {
    capture: { resolution: preset.resolution },
    publish: { videoEncoding: preset.encoding, simulcast: false },
  } as const
}

function screenPublishArgs(quality: PublishQuality) {
  const preset = screenPreset(quality)
  return {
    capture: { resolution: preset.resolution },
    publish: { videoEncoding: preset.encoding, simulcast: false },
  } as const
}

/**
 * preflight와 classroom이 공유하는 session-scoped LiveKit Room 소유자(ADR-0002 §1).
 *
 * <p>이 Provider는 두 페이지의 공통 route 부모에 mount된다. 따라서 preflight → classroom 전환은
 * Room/track을 끊지 않고, 다른 session이나 processing으로 나갈 때만 cleanup한다.
 */
export default function InstructorLiveMediaProvider({ children }: { children?: ReactNode }) {
  const { sessionId = '' } = useParams()
  const roomRef = useRef<Room | null>(null)
  const disconnectRef = useRef<Promise<void>>(Promise.resolve())
  const [retryCount, setRetryCount] = useState(0)
  const [pendingControl, setPendingControl] = useState<MediaControl | 'initial' | null>(null)
  const [state, setState] = useState<InstructorLiveKitState>(initialState)
  const [quality, setQuality] = useState<PublishQuality>(loadPublishQuality)
  const [applyingQuality, setApplyingQuality] = useState(false)
  // Room 생성 effect가 품질 변경마다 재실행되면 연결이 끊긴다. 최신 값은 ref로만 읽고,
  // 이미 올라간 트랙은 재게시로 반영한다.
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const [cameraOverlay, setCameraOverlay] = useState<CameraOverlay>(DEFAULT_CAMERA_OVERLAY)
  const overlayRef = useRef(cameraOverlay)
  overlayRef.current = cameraOverlay

  const syncLocalState = useCallback((room: Room) => {
    setState((current) => ({
      ...current,
      cameraEnabled: room.localParticipant.isCameraEnabled,
      microphoneEnabled: room.localParticipant.isMicrophoneEnabled,
      screenShareEnabled: room.localParticipant.isScreenShareEnabled,
      cameraTrack: getLocalVideoTrack(room, Track.Source.Camera),
      screenShareTrack: getLocalVideoTrack(room, Track.Source.ScreenShare),
      mediaRevision: current.mediaRevision + 1,
    }))
  }, [])

  useEffect(() => {
    if (!sessionId) {
      setState(initialState)
      return
    }

    if (isMockApiEnabled) {
      let cancelled = false
      setState((current) => ({ ...current, connectionState: 'preparing', errorMessage: undefined }))
      void preparePreflightRoom(sessionId)
        .then(() => {
          if (!cancelled) {
            setState({
              connectionState: 'mock',
              cameraEnabled: true,
              microphoneEnabled: true,
              screenShareEnabled: false,
              mediaRevision: 1,
            })
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setState((current) => ({
              ...current,
              connectionState: 'error',
              errorMessage: describeConnectionError(error),
            }))
          }
        })
      return () => { cancelled = true }
    }

    let cancelled = false
    let connectionFailed = false
    const room = new Room({
      // dynacast는 아무도 구독하지 않는 트랙의 송출을 멈춘다. 레이어가 하나뿐이어도
      // 구독자 없는 구간에서 업링크를 아끼므로 그대로 둔다.
      dynacast: true,
      // 강사가 사전 점검에서 고른 값(publishQuality). 기본값은 최고 화질이다.
      videoCaptureDefaults: { resolution: cameraPreset(qualityRef.current).resolution },
      publishDefaults: {
        // 사이멀캐스트를 끈다. 학생은 WebRTC로 직접 구독하지 않고 HLS로만 보므로(ADR-0032)
        // 강사 트랙의 구독자는 Egress 하나뿐이고, Egress는 언제나 최상위 레이어만 쓴다.
        // 320x180·640x360은 아무도 보지 않는데 계속 인코딩되고 있었다.
        //
        // 그냥 낭비가 아니라 화질 저하의 직접 원인이었다. VP8 1080p 3레이어 소프트웨어 인코딩을
        // 브라우저가 감당하지 못해 최상위 레이어를 버렸고(카메라 기본 degradationPreference가
        // maintain-framerate라 프레임률 대신 해상도를 포기한다), Egress는 남은 640x360을 받아
        // 1920x1080으로 3배 확대해 인코딩했다. 운영 세션에서 실측한 근거:
        //
        //   레이어 상태   HIGH 1920x1080 이 ssrc 없이 비활성, MEDIUM 640x360 만 활성
        //   프레임 분석   가로 인접 화소 밝기차 RMS 비율 d1/d3 = 0.361
        //                 (3배 업스케일 구간. 원본 해상도라면 0.6 이상)
        //   배율 일치     640 x 3 = 1920
        //
        // 레이어가 하나면 버릴 최상위가 없다. 인코딩 부담이 1/3로 줄고 Egress가 진짜 1080p를 받는다.
        // 학생 WebRTC 직접 구독을 도입한다면(ADR-0032 개정) 이 선택을 되돌려야 한다.
        simulcast: false,
        // 카메라 단독 강의에서 Egress 캔버스(1080p)를 업스케일 없이 채우려면 소스가 1080p여야 한다.
        // 웹캠이 1080p를 못 내면 ideal 제약이라 720p로 협상된다.
        videoEncoding: cameraPreset(qualityRef.current).encoding,
        // 화면공유는 코드·슬라이드 텍스트라 비트레이트가 판독성을 좌우한다. 기본 h1080fps15(2.5Mbps)는
        // 스크롤 구간에서 글자가 뭉갠다. 30fps 프리셋은 같은 1080p에 5Mbps다.
        screenShareEncoding: screenPreset(qualityRef.current).encoding,
      },
    })
    roomRef.current = room

    const onReconnecting = () => {
      if (!cancelled) {
        setState((current) => ({
          ...current,
          connectionState: 'reconnecting',
          errorMessage: undefined,
          mediaRevision: current.mediaRevision + 1,
        }))
      }
    }
    const onReconnected = () => {
      if (!cancelled) {
        setState((current) => ({ ...current, connectionState: 'connected', errorMessage: undefined }))
        syncLocalState(room)
      }
    }
    const onDisconnected = () => {
      if (!cancelled && !connectionFailed) {
        setState((current) => ({
          ...current,
          connectionState: 'disconnected',
          errorMessage: 'LiveKit 송출 연결이 종료되었습니다.',
          mediaRevision: current.mediaRevision + 1,
        }))
      }
    }
    const onMediaDevicesError = (error: Error) => {
      if (!cancelled) {
        setState((current) => ({ ...current, errorMessage: describeMediaError(error) }))
      }
    }
    const onLocalTrackChanged = () => {
      if (!cancelled) syncLocalState(room)
    }

    room
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Reconnected, onReconnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.MediaDevicesError, onMediaDevicesError)
      .on(RoomEvent.LocalTrackPublished, onLocalTrackChanged)
      .on(RoomEvent.LocalTrackUnpublished, onLocalTrackChanged)
      .on(RoomEvent.TrackMuted, onLocalTrackChanged)
      .on(RoomEvent.TrackUnmuted, onLocalTrackChanged)

    const connect = async () => {
      await disconnectRef.current.catch(() => undefined)
      if (cancelled) return

      setState({ ...initialState, connectionState: 'preparing' })
      try {
        // 방을 명시적으로 만든 뒤 같은 session token으로 접속한다. 이 순서가 roomSid 영속을 보장한다.
        await preparePreflightRoom(sessionId)
        if (cancelled) return
        setState((current) => ({ ...current, connectionState: 'connecting' }))
        const { token, wsUrl } = await getInstructorLiveToken(sessionId)
        if (!wsUrl) throw new Error('LiveKit 접속 주소가 토큰 응답에 없습니다.')
        if (cancelled) return

        await room.connect(wsUrl, token, { autoSubscribe: false })
        if (cancelled) {
          await room.disconnect(true)
          return
        }

        setState((current) => ({ ...current, connectionState: 'connected', errorMessage: undefined }))
        setPendingControl('initial')
        // 마이크가 필수 gate다. 카메라 실패가 마이크 publish까지 롤백하지 않도록 따로 켠다.
        await room.localParticipant.setMicrophoneEnabled(true)
        try {
          await room.localParticipant.setCameraEnabled(true)
        } catch (error) {
          if (!cancelled) {
            setState((current) => ({ ...current, errorMessage: describeMediaError(error) }))
          }
        }
        if (!cancelled) syncLocalState(room)
      } catch (error) {
        connectionFailed = true
        await room.disconnect(true).catch(() => undefined)
        if (!cancelled) {
          setState((current) => ({
            ...current,
            connectionState: 'error',
            errorMessage: describeConnectionError(error),
            mediaRevision: current.mediaRevision + 1,
          }))
        }
      } finally {
        if (!cancelled) setPendingControl(null)
      }
    }

    void connect()

    return () => {
      cancelled = true
      room
        .off(RoomEvent.Reconnecting, onReconnecting)
        .off(RoomEvent.Reconnected, onReconnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.MediaDevicesError, onMediaDevicesError)
        .off(RoomEvent.LocalTrackPublished, onLocalTrackChanged)
        .off(RoomEvent.LocalTrackUnpublished, onLocalTrackChanged)
        .off(RoomEvent.TrackMuted, onLocalTrackChanged)
        .off(RoomEvent.TrackUnmuted, onLocalTrackChanged)
      if (roomRef.current === room) roomRef.current = null
      disconnectRef.current = room.disconnect(true).catch(() => undefined)
    }
  }, [retryCount, sessionId, syncLocalState])

  const toggleControl = useCallback(async (control: MediaControl) => {
    if (state.connectionState === 'mock') {
      setState((current) => {
        if (control === 'camera') return { ...current, cameraEnabled: !current.cameraEnabled, mediaRevision: current.mediaRevision + 1 }
        if (control === 'microphone') return { ...current, microphoneEnabled: !current.microphoneEnabled, mediaRevision: current.mediaRevision + 1 }
        return { ...current, screenShareEnabled: !current.screenShareEnabled, mediaRevision: current.mediaRevision + 1 }
      })
      return
    }

    const room = roomRef.current
    if (!room || state.connectionState !== 'connected' || pendingControl) return

    setPendingControl(control)
    setState((current) => ({ ...current, errorMessage: undefined }))
    try {
      if (control === 'camera') {
        const { capture, publish } = cameraPublishArgs(qualityRef.current)
        await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled, capture, publish)
      }
      if (control === 'microphone') await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled)
      if (control === 'screenShare') {
        const { capture, publish } = screenPublishArgs(qualityRef.current)
        await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, capture, publish)
      }
      syncLocalState(room)
    } catch (error) {
      setState((current) => ({ ...current, errorMessage: describeMediaError(error) }))
    } finally {
      setPendingControl(null)
    }
  }, [pendingControl, state.connectionState, syncLocalState])

  /**
   * 품질 변경을 즉시 반영한다. Room을 다시 만들면 연결이 끊기므로, 이미 올라간 트랙만
   * 껐다 다시 올린다. 미리보기에서 바로 확인하고 조정할 수 있어야 의미가 있는 설정이다.
   */
  const changeQuality = useCallback((next: Partial<PublishQuality>) => {
    const merged = { ...qualityRef.current, ...next }
    qualityRef.current = merged
    setQuality(merged)
    savePublishQuality(merged)

    const room = roomRef.current
    if (!room || state.connectionState !== 'connected') return

    const republish = async () => {
      setApplyingQuality(true)
      setState((current) => ({ ...current, errorMessage: undefined }))
      try {
        if (next.camera && room.localParticipant.isCameraEnabled) {
          const { capture, publish } = cameraPublishArgs(merged)
          await room.localParticipant.setCameraEnabled(false)
          await room.localParticipant.setCameraEnabled(true, capture, publish)
        }
        if (next.screenShare && room.localParticipant.isScreenShareEnabled) {
          // 화면공유는 다시 올리면 브라우저가 공유 대상을 새로 묻는다. 강사가 강의 도중
          // 예기치 않게 선택 창을 만나지 않도록, 켜져 있으면 다음 공유부터 적용한다.
          setState((current) => ({
            ...current,
            errorMessage: '화면공유 화질은 공유를 다시 시작할 때 적용됩니다.',
          }))
        }
        syncLocalState(room)
      } catch (error) {
        setState((current) => ({ ...current, errorMessage: describeMediaError(error) }))
      } finally {
        setApplyingQuality(false)
      }
    }
    void republish()
  }, [state.connectionState, syncLocalState])

  /**
   * 카메라 배치를 강사 participant metadata에 쓴다. Egress 템플릿이 이 값을 읽어 합성하므로
   * 강사가 미리보기에서 옮긴 자리가 그대로 수강생 녹화가 된다.
   *
   * <p>화면은 즉시 갱신하고 metadata 전송은 뒤따르게 한다 — 드래그 중에 서버 왕복을 기다리면
   * 화면이 손가락을 따라오지 못한다. 전송이 실패해도 미리보기는 그대로 두고, 다음 조작 때
   * 최신 값이 다시 나간다(마지막 값이 이긴다).
   */
  const moveCameraOverlay = useCallback((next: Partial<CameraOverlay>) => {
    const merged = clampOverlay({ ...overlayRef.current, ...next })
    overlayRef.current = merged
    setCameraOverlay(merged)

    const room = roomRef.current
    if (!room || state.connectionState !== 'connected') return
    const participant = room.localParticipant
    void participant
      .setMetadata(withCameraOverlay(participant.metadata, merged))
      .catch((error) => {
        console.warn('카메라 배치를 합성 화면에 전달하지 못했습니다', error)
      })
  }, [state.connectionState])

  // 재연결하면 participant가 새로 만들어져 metadata가 비고, 합성 화면이 기본 배치로 돌아간다.
  // 강사가 옮겨 둔 자리를 다시 실어 준다.
  useEffect(() => {
    const room = roomRef.current
    if (!room || state.connectionState !== 'connected') return
    const participant = room.localParticipant
    const current = parseCameraOverlay(participant.metadata)
    if (JSON.stringify(current) === JSON.stringify(overlayRef.current)) return
    void participant
      .setMetadata(withCameraOverlay(participant.metadata, overlayRef.current))
      .catch(() => undefined)
  }, [state.connectionState])

  const value = useMemo<InstructorLiveMedia>(() => ({
    ...state,
    sessionId,
    pendingControl,
    canControl: state.connectionState === 'connected' || state.connectionState === 'mock',
    quality,
    changeQuality,
    cameraOverlay,
    moveCameraOverlay,
    applyingQuality,
    retry: () => setRetryCount((current) => current + 1),
    toggleCamera: () => { void toggleControl('camera') },
    toggleMicrophone: () => { void toggleControl('microphone') },
    toggleScreenShare: () => { void toggleControl('screenShare') },
  }), [applyingQuality, cameraOverlay, changeQuality, moveCameraOverlay, pendingControl, quality, sessionId, state, toggleControl])

  return (
    <InstructorLiveMediaContext.Provider value={value}>
      {children ?? <Outlet />}
    </InstructorLiveMediaContext.Provider>
  )
}

export function useInstructorLiveKit() {
  const context = useContext(InstructorLiveMediaContext)
  if (!context) {
    throw new Error('useInstructorLiveKit은 InstructorLiveMediaProvider 안에서 사용해야 합니다.')
  }
  return context
}
