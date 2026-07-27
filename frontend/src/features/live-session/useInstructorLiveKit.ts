import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LocalVideoTrack,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { getLiveToken } from './liveSessionService'

export type InstructorLiveKitConnectionState =
  | 'idle'
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
}

const initialState: InstructorLiveKitState = {
  connectionState: 'idle',
  cameraEnabled: false,
  microphoneEnabled: false,
  screenShareEnabled: false,
}

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

export function useInstructorLiveKit(sessionId: string, enabled: boolean) {
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
    }))
  }, [])

  useEffect(() => {
    if (!enabled) {
      setState(initialState)
      setPendingControl(null)
      return
    }

    if (isMockApiEnabled) {
      setState({
        connectionState: 'mock',
        cameraEnabled: true,
        microphoneEnabled: true,
        screenShareEnabled: false,
      })
      setPendingControl(null)
      return
    }

    let cancelled = false
    let connectionFailed = false
    const room = new Room({ dynacast: true })
    roomRef.current = room

    const onReconnecting = () => {
      if (!cancelled) setState((current) => ({ ...current, connectionState: 'reconnecting', errorMessage: undefined }))
    }
    const onReconnected = () => {
      if (!cancelled) {
        setState((current) => ({ ...current, connectionState: 'connected', errorMessage: undefined }))
        syncLocalState(room)
      }
    }
    const onDisconnected = () => {
      if (!cancelled && !connectionFailed) {
        setState((current) => ({ ...current, connectionState: 'disconnected', errorMessage: 'LiveKit 송출 연결이 종료되었습니다.' }))
      }
    }
    const onMediaDevicesError = (error: Error) => {
      if (!cancelled) setState((current) => ({ ...current, errorMessage: describeMediaError(error) }))
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

      setState({ ...initialState, connectionState: 'connecting' })
      try {
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
        try {
          await room.localParticipant.enableCameraAndMicrophone()
        } catch (error) {
          if (!cancelled) setState((current) => ({ ...current, errorMessage: describeMediaError(error) }))
        } finally {
          if (!cancelled) {
            syncLocalState(room)
            setPendingControl(null)
          }
        }
      } catch (error) {
        connectionFailed = true
        await room.disconnect(true).catch(() => undefined)
        if (!cancelled) {
          setState((current) => ({ ...current, connectionState: 'error', errorMessage: describeConnectionError(error) }))
          setPendingControl(null)
        }
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
  }, [enabled, retryCount, sessionId, syncLocalState])

  const toggleControl = useCallback(async (control: MediaControl) => {
    if (state.connectionState === 'mock') {
      setState((current) => {
        if (control === 'camera') return { ...current, cameraEnabled: !current.cameraEnabled }
        if (control === 'microphone') return { ...current, microphoneEnabled: !current.microphoneEnabled }
        return { ...current, screenShareEnabled: !current.screenShareEnabled }
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

  const retry = useCallback(() => setRetryCount((current) => current + 1), [])
  const canControl = state.connectionState === 'connected' || state.connectionState === 'mock'

  return {
    ...state,
    pendingControl,
    canControl,
    retry,
    toggleCamera: () => toggleControl('camera'),
    toggleMicrophone: () => toggleControl('microphone'),
    toggleScreenShare: () => toggleControl('screenShare'),
  }
}
