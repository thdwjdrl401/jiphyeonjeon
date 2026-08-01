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
import { resolveCsrfHeader } from '@/shared/api/client'
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
import {
  ANNOTATION_LASER_TOPIC,
  ANNOTATION_TOPIC,
  encodeAnnotationOp,
  encodeLaserStroke,
  trimOpPrecision,
  type AnnotationChange,
  type AnnotationDocument,
  type AnnotationOp,
  type LaserStroke,
} from './annotation'
import { createAnnotationOpSink, fetchAnnotationDocument, type AnnotationOpSink } from './annotationPersistence'

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
  /**
   * 판서 변경을 데이터 채널로 내보낸다(ADR-0051). `revision`은 여기서 붙는다 — 강사가 단일 writer이므로
   * 번호를 매기는 곳이 하나여야 한다.
   */
  publishAnnotation: (change: AnnotationChange) => void
  /**
   * "여기까지의 전체 상태"를 수신 측에 알린다(ADR-0055).
   *
   * <p>밀린 저장을 비운 뒤 <b>포인터</b>만 보낸다 — 문서 전체를 실어 보내면 판서가 길어질수록
   * 커져 데이터 채널의 64KB 한도를 넘고, 넘는 순간 수강생 화면에 판서가 아예 나오지 않는다.
   *
   * <p>저장이 밀려 있어 포인터가 거짓이 될 상황이면 인자로 받은 스냅샷으로 물러선다. 그래서
   * 스냅샷을 <b>값이 아니라 함수로</b> 받는다 — 물러설 때만 만들면 되고, 그때는 flush를 기다린
   * 뒤라 가장 최근 문서를 담을 수 있다.
   */
  publishAnnotationState: (snapshot: () => AnnotationChange) => void
  /**
   * 레이저 궤적을 내보낸다. 판서 op와 <b>다른 topic에 lossy로</b> 보낸다 — 초당 수십 건이고 1초면
   * 사라지므로 유실돼도 무해하고, revision을 태우면 유실 감지가 의미를 잃는다.
   */
  publishLaser: (stroke: LaserStroke) => void
  /**
   * 새 참가자가 들어올 때마다 오른다. 판서를 들고 있는 화면이 이 값을 보고 <b>스냅샷을 다시 내보낸다</b> —
   * 새로 들어온 Egress는 그 전에 흐른 op를 받을 수 없어, 이것이 없으면 판서가 빈 채로 녹화된다.
   */
  annotationAudienceRevision: number
  /**
   * 서버에 저장돼 있던 판서(ADR-0051). 강사가 새로고침해도 이걸로 에디터를 되살린다 — 없으면
   * 강사 화면만 비고 수강생·녹화에는 남아, 같은 화면이라는 전제가 깨진다.
   *
   * <p>아직 불러오지 못했으면 null이다. 빈 문서(`elements: []`)와 구분해야 한다 — 빈 문서로 에디터를
   * 열어 버리면 나중에 도착한 복원본이 강사가 그 사이 그린 획을 덮는다.
   */
  restoredAnnotation: AnnotationDocument | null
  /**
   * 새로고침 직전의 판서 표시 상태(ADR-0056). 아직 불러오지 못했으면 null.
   *
   * <p>화면은 이 값으로 판서를 켤지 정한다. 서버가 정본이고, 이 값이 오기 전까지는 로컬 캐시가
   * 임시로 화면을 채운다.
   */
  restoredAnnotationVisible: boolean | null
  /** 표시 상태를 서버에 남긴다. 강사가 판서를 켜고 끌 때 부른다. */
  saveAnnotationVisible: (visible: boolean) => void
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

  /**
   * 판서 op 번호. state가 아니라 ref다 — op를 낼 때마다 렌더를 유발하면 획을 그을 때마다 강사 화면
   * 전체가 다시 그려진다.
   */
  const annotationRevisionRef = useRef(0)
  /**
   * 강사가 <b>실제로 그렸는가</b>. 번호가 올라갔는지와 다르다.
   *
   * <p>복원본을 덮어쓰지 않으려는 가드는 "강사가 복원을 기다리지 않고 이미 그렸다"를 뜻해야 한다.
   * 그런데 번호는 포인터·빈 스냅샷·`clear`처럼 <b>문서를 바꾸지 않는 op</b>에도 올라간다. 그것들을
   * "그렸다"로 세면, 강사가 복원 전에 판서를 켜기만 해도 복원본이 통째로 버려진다 — 이전에 그린
   * 판서가 강사 화면에서 사라진다.
   */
  const annotationDrawnRef = useRef(false)
  const [annotationAudienceRevision, setAnnotationAudienceRevision] = useState(0)
  const [restoredAnnotation, setRestoredAnnotation] = useState<AnnotationDocument | null>(null)
  const [restoredAnnotationVisible, setRestoredAnnotationVisible] = useState<boolean | null>(null)

  /**
   * 판서를 서버에 남기는 대기열(ADR-0051). 라이브 전달과 <b>병렬</b>이라 여기가 막히거나 실패해도
   * 강사 화면과 수강생 화면은 그대로 간다.
   */
  const annotationSinkRef = useRef<AnnotationOpSink | null>(null)
  useEffect(() => {
    const sink = createAnnotationOpSink(sessionId)
    annotationSinkRef.current = sink
    // 새로고침·탭 전환으로 페이지가 사라지기 직전이 마지막 기회다. 여기서 비우지 않으면 방금 그린
    // 획이 저장되지 않아, 복원했을 때 끝부분만 빠진 판서가 나온다.
    const flush = () => { sink.flush(true) }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      sink.stop()
      annotationSinkRef.current = null
    }
  }, [sessionId])

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
    /**
     * 새로 들어온 참가자는 그 전에 흐른 판서 op를 받을 방법이 없다. Egress가 강의 도중 재접속하면
     * 판서가 통째로 빈 채로 녹화되므로, "누가 들어왔다"를 화면 쪽에 알려 스냅샷을 다시 내보내게 한다
     * (ADR-0051). 여기서 직접 보내지 않는 이유는 판서 문서를 들고 있는 곳이 화면 쪽이기 때문이다.
     */
    const onParticipantConnected = () => {
      if (!cancelled) setAnnotationAudienceRevision((current) => current + 1)
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
      .on(RoomEvent.ParticipantConnected, onParticipantConnected)

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
        .off(RoomEvent.ParticipantConnected, onParticipantConnected)
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

  /**
   * 판서 변경을 데이터 채널로 보낸다.
   *
   * <p>`reliable`로 보낸다 — 판서는 유실되면 화면에서 획이 빠진 채로 남는다. 카메라 배치처럼 "다음
   * 값이 덮어쓰는" 성질이 아니므로 한 번 놓친 획은 스냅샷 전까지 복구되지 않는다.
   *
   * <p>실패해도 강사 화면은 건드리지 않는다. 강사는 자기 에디터를 직접 보고 있으므로 이미 그린 획을
   * 되돌리면 오히려 혼란스럽다 — 대신 콘솔에 남기고 다음 스냅샷이 상태를 맞춘다.
   */
  const publishAnnotation = useCallback((change: AnnotationChange) => {
    const room = roomRef.current
    if (!room || room.state !== 'connected') return

    annotationRevisionRef.current += 1
    /*
     * 나가는 사본에서 의미 없는 좌표 정밀도를 덜어낸다(§3-6b).
     *
     * <p>여기가 유일한 관문이다 — 데이터 채널과 영속화가 모두 이 op를 쓰므로, 한 곳에서 다듬으면
     * 둘 다 줄어든다. 강사의 문서는 그대로 둔다: 에디터가 들고 있는 값을 바꾸면 version 기반
     * diff가 그것을 "바뀐 요소"로 보고 다시 내보낸다.
     */
    const op = trimOpPrecision({ ...change, revision: annotationRevisionRef.current } as AnnotationOp)
    void room.localParticipant
      .publishData(encodeAnnotationOp(op), { reliable: true, topic: ANNOTATION_TOPIC })
      .catch((error) => {
        console.warn('판서를 합성 화면에 전달하지 못했습니다', error)
      })
    // 전달과 별개로 기록을 남긴다. 순서가 중요하다 — 저장을 먼저 기다리면 그 왕복이 획마다 끼어든다.
    //
    // 다만 <b>전달에만 쓰는 op는 남기지 않는다.</b> 복원은 마지막 스냅샷부터 접으므로, 문서를 담지
    // 않은 op가 그 자리에 앉으면 그 앞의 판서가 통째로 사라진다.
    //
    // <ul>
    //   <li>`clear` — 지우기가 아니라 판서를 껐을 때 수강생 화면에서 <b>감추라는</b> 표시 상태다.
    //       강사의 문서는 그대로 남아 다시 켜면 돌아온다.</li>
    //   <li><b>빈 스냅샷</b> — 수신 측의 revision 기준점을 잡는 장치다. 문서가 실제로 비었다는 뜻이
    //       아니다(그건 `delete`로 기록된다). 페이지를 열 때마다 하나씩 쌓여, 저장하면 그 뒤로
    //       새로고침했을 때 복원이 빈 문서에서 시작한다.</li>
    //   <li>`pointer` — 문서가 아니라 "전체 상태는 서버에 있다"는 안내다(ADR-0055). 담을 내용이 없다.</li>
    // </ul>
    if (op.type === 'upsert' || op.type === 'delete') annotationDrawnRef.current = true
    const transportOnly = op.type === 'clear'
      || op.type === 'pointer'
      || (op.type === 'snapshot' && op.elements.length === 0)
    if (!transportOnly) annotationSinkRef.current?.push(op)
  }, [])

  /**
   * 전체 상태를 알린다 — 스냅샷을 밀지 않고 <b>포인터</b>를 낸다(ADR-0055).
   *
   * <p><b>비우고 나서 낸다.</b> 영속화는 1.5초 주기 묶음이라 서버가 강사보다 뒤처져 있다. 그대로
   * 포인터를 내면 수신 측이 받는 문서에 마지막 몇 획이 빠지고, 그 뒤 델타와 이어지지 않아 <b>이후
   * op가 전부 버려진다</b> — 강사 화면에는 그려지는데 녹화에는 나타나지 않는다.
   *
   * <p><b>비우지 못하면 포인터를 내지 않는다.</b> 그때의 포인터는 지킬 수 없는 약속이다. 대신
   * 예전처럼 스냅샷을 민다 — 64KB를 넘을 수 있지만 그건 저장이 이미 실패하고 있는 예외 상황이고,
   * 아무것도 보내지 않는 것보다 낫다.
   */
  const publishAnnotationState = useCallback((snapshot: () => AnnotationChange) => {
    const room = roomRef.current
    if (!room || room.state !== 'connected') return

    const sink = annotationSinkRef.current
    void (sink ? sink.flushAll() : Promise.resolve(true)).then((stored) => {
      // flush를 기다리는 동안 끊겼을 수 있다. 재연결하면 그쪽에서 다시 맞춘다.
      if (roomRef.current?.state !== 'connected') return
      publishAnnotation(stored ? { type: 'pointer' } : snapshot())
      if (!stored) {
        console.warn('판서 저장이 밀려 포인터 대신 스냅샷을 보냅니다(크기 한도를 넘을 수 있습니다).')
      }
    })
  }, [publishAnnotation])

  /**
   * 새 페이지에서 접속하면 <b>빈 스냅샷</b>을 한 번 보내 Egress를 강사의 실제 상태로 맞춘다.
   *
   * <p>강사가 새로고침하면 두 가지가 어긋난다.
   *
   * <ol>
   *   <li>강사 화면의 판서는 사라지는데 Egress는 자기 문서를 계속 렌더한다 — 수강생과 녹화에만 남는다.
   *       페이지가 죽는 순간이라 `clear`를 보낼 기회조차 없다.</li>
   *   <li>{@code annotationRevisionRef}가 0부터 다시 시작해, 새로 그린 획이 revision 1·2·3…으로 나간다.
   *       Egress의 문서 revision은 살아 있어(예: 47) <b>전부 중복으로 보고 버린다</b> — 강사 화면에는
   *       그려지는데 수강생에게는 영영 나타나지 않는다.</li>
   * </ol>
   *
   * <p>빈 스냅샷 하나가 둘 다 푼다. `snapshot`은 revision 검사를 건너뛰므로(applyAnnotationOp) Egress가
   * 반드시 받아들이고, 그 값으로 revision이 내려앉아 이후 op가 정상 적용된다. `clear`로는 안 된다 —
   * 그건 revision 검사를 받아 똑같이 버려진다.
   *
   * <p>이번 페이지에서 이미 무언가 publish했다면 보내지 않는다. 그때의 재연결은 새로고침이 아니라
   * 네트워크 끊김이고, 강사는 판서를 들고 있으므로 비우면 안 된다.
   */
  const annotationRestoredRef = useRef(false)
  useEffect(() => {
    if (state.connectionState !== 'connected') return
    // 이 페이지에서 한 번만. 재연결은 새로고침이 아니라 끊김이고, 그때 서버를 다시 읽으면 아직
    // 저장되지 않은 최근 획이 빠진 문서가 강사 화면을 덮어쓴다. 새로 들어온 Egress를 맞추는 일은
    // annotationAudienceRevision이 따로 한다.
    if (annotationRestoredRef.current) return
    annotationRestoredRef.current = true

    let cancelled = false
    void fetchAnnotationDocument(sessionId).then((restored) => {
      if (cancelled) return
      // 강사가 복원을 기다리지 않고 이미 그렸다면 그 획이 먼저다. 번호만 이어 붙이고 덮어쓰지 않는다.
      // <b>그렸는지</b>로 본다 — 번호로 보면 판서를 켜기만 해도(포인터) 복원본이 버려진다.
      if (annotationDrawnRef.current) {
        annotationRevisionRef.current += restored.nextRevision
        return
      }
      annotationRevisionRef.current = restored.nextRevision - 1
      setRestoredAnnotation(restored.document)
      setRestoredAnnotationVisible(restored.visible)
      // 복원한 판서를 여기서 내보내지 않는다. 새로고침 직후 판서는 <b>꺼진 상태</b>로 시작하므로,
      // 여기서 내보내면 강사에게는 안 보이는 판서가 수강생 화면에만 뜬다. 내보내는 일은 판서를 켤 때
      // 레이어가 한다(InstructorAnnotationLayer). 여기서는 <b>빈 스냅샷</b>으로 번호만 맞춘다 —
      // Egress는 revision 0에서 시작하는데 강사는 이어받은 번호(예: 48)부터 매기므로, 이 기준점이
      // 없으면 이후 op가 전부 "중간이 빠졌다"로 버려진다.
      publishAnnotation({ type: 'snapshot', elements: [] })

      /*
       * <b>강사 화면 = 수강생 화면.</b> 복원한 표시 상태를 수신 측에도 반드시 알린다(ADR-0056).
       *
       * <p>판서를 끈 채로 새로고침하면 강사 화면은 비어 있는데 Egress는 자기 문서를 계속 그린다 —
       * 여기서 `clear`를 내지 않으면 <b>수강생에게만 판서가 남는다.</b> 그 어긋남은 강사 화면에서
       * 정상으로 보이므로 알아챌 수 없다.
       *
       * <p>켜진 상태로 복원할 때는 화면 쪽(레이어)이 켜지면서 포인터를 낸다. 여기서 또 내면 같은
       * 일이 두 번 일어난다.
       */
      if (!restored.visible) publishAnnotation({ type: 'clear' })
    })
    return () => { cancelled = true }
  }, [publishAnnotation, sessionId, state.connectionState])

  /**
   * 표시 상태를 서버에 남긴다(ADR-0056).
   *
   * <p>실패해도 화면을 되돌리지 않는다 — 강사는 이미 켜거나 끈 화면을 보고 있고, 그것을 되돌리면
   * 오히려 혼란스럽다. 다음 조작이나 다음 새로고침이 상태를 맞춘다.
   */
  const saveAnnotationVisible = useCallback((visible: boolean) => {
    void (async () => {
      try {
        const response = await fetch(`/api/live-sessions/${sessionId}/annotation/visibility`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(await resolveCsrfHeader()) },
          body: JSON.stringify({ visible }),
        })
        if (!response.ok) throw new Error(`판서 표시 상태 저장 실패: ${response.status}`)
      } catch (error) {
        console.warn('판서 표시 상태를 서버에 남기지 못했습니다', error)
      }
    })()
  }, [sessionId])

  const publishLaser = useCallback((stroke: LaserStroke) => {
    const room = roomRef.current
    if (!room || room.state !== 'connected') return
    // reliable=false: 재전송하지 않는다. 늦게 도착한 잔상 조각은 이미 사라졌어야 할 점이라 오히려
    // 궤적을 어지럽힌다. 실패도 조용히 넘긴다 — 레이저 한 조각이 강의를 막을 이유가 없다.
    void room.localParticipant
      .publishData(encodeLaserStroke(stroke), { reliable: false, topic: ANNOTATION_LASER_TOPIC })
      .catch(() => undefined)
  }, [])

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
    publishAnnotation,
    publishAnnotationState,
    publishLaser,
    annotationAudienceRevision,
    restoredAnnotation,
    restoredAnnotationVisible,
    saveAnnotationVisible,
    applyingQuality,
    retry: () => setRetryCount((current) => current + 1),
    toggleCamera: () => { void toggleControl('camera') },
    toggleMicrophone: () => { void toggleControl('microphone') },
    toggleScreenShare: () => { void toggleControl('screenShare') },
  }), [annotationAudienceRevision, applyingQuality, cameraOverlay, changeQuality, moveCameraOverlay, pendingControl, publishAnnotation, publishAnnotationState, publishLaser, quality, restoredAnnotation, restoredAnnotationVisible, saveAnnotationVisible, sessionId, state, toggleControl])

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
