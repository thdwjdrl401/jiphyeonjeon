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
  ScreenSharePresets,
  Track,
  VideoPresets,
} from 'livekit-client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { getLiveToken, preparePreflightRoom } from './liveSessionService'

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
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h1080.resolution },
      publishDefaults: {
        videoEncoding: VideoPresets.h1080.encoding,
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
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
        const { token, wsUrl } = await getLiveToken(sessionId)
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
      if (control === 'camera') await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled)
      if (control === 'microphone') await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled)
      if (control === 'screenShare') await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled)
      syncLocalState(room)
    } catch (error) {
      setState((current) => ({ ...current, errorMessage: describeMediaError(error) }))
    } finally {
      setPendingControl(null)
    }
  }, [pendingControl, state.connectionState, syncLocalState])

  const value = useMemo<InstructorLiveMedia>(() => ({
    ...state,
    sessionId,
    pendingControl,
    canControl: state.connectionState === 'connected' || state.connectionState === 'mock',
    retry: () => setRetryCount((current) => current + 1),
    toggleCamera: () => { void toggleControl('camera') },
    toggleMicrophone: () => { void toggleControl('microphone') },
    toggleScreenShare: () => { void toggleControl('screenShare') },
  }), [pendingControl, sessionId, state, toggleControl])

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
