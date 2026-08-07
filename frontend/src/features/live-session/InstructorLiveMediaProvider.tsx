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
  LocalAudioTrack,
  LocalVideoTrack,
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
import {
  armDemoPublish,
  createDemoTracks,
  demoHasAudio,
  demoPublishState,
  disarmDemoPublish,
  releaseDemoTracks,
  type DemoPublishState,
} from './demoPublish'
import {
  describeMediaFailure,
  hasInputDevice,
  preflightMediaFailure,
  queryMediaPermission,
  watchMediaPermission,
  type MediaFailure,
  type MediaKind,
  type MediaPermissionState,
} from './mediaFailure'

export type InstructorLiveKitConnectionState =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'
  | 'mock'

type MediaControl = MediaKind

interface InstructorLiveKitState {
  connectionState: InstructorLiveKitConnectionState
  cameraEnabled: boolean
  microphoneEnabled: boolean
  screenShareEnabled: boolean
  cameraTrack?: LocalVideoTrack
  screenShareTrack?: LocalVideoTrack
  /** 켜져 있는 마이크 트랙. 사전 점검의 소리 게이지가 이걸 읽는다. */
  microphoneTrack?: LocalAudioTrack
  /**
   * <b>방 연결</b>의 문제만 담는다. 장치 문제는 `mediaFailure`로 간다.
   *
   * <p>둘을 한 칸에 담았더니 마이크가 없는 컴퓨터에서 "연결 실패"가 떴다. 강사는 라이브킷이나
   * 네트워크를 의심하게 되는데, 실제로는 방에 이미 들어와 있었다.
   */
  errorMessage?: string
  /** 마이크·카메라·화면공유가 안 열린 이유. 연결은 살아 있다. */
  mediaFailure?: MediaFailure
  /** 오류가 아닌 알림. 붉은 경고로 띄우면 안 되는 것들이 여기 온다. */
  notice?: string
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
  /**
   * 복원 체크포인트를 남긴다(ADR-0057). 문서-변경 op가 일정 수 쌓일 때마다 화면 쪽이 부른다.
   *
   * <p><b>데이터 채널로는 나가지 않는다.</b> 영속화 경로로만 보낸다 — 문서 전체를 채널에 실으면
   * ADR-0055가 없앤 64KB 문제가 되돌아온다.
   */
  saveAnnotationSnapshot: (snapshot: () => AnnotationChange) => void
  /** 품질 변경으로 트랙을 다시 올리는 중. 이때는 선택을 잠근다. */
  applyingQuality: boolean
  /**
   * 브라우저에 저장된 마이크 권한. 화면이 "왜 안 되는지"를 요청 전에 말할 수 있는 근거다.
   *
   * <p>`unknown`은 조회를 지원하지 않는 브라우저다 — 모른다는 뜻이지 없다는 뜻이 아니므로
   * 이 값으로 요청을 막지 않는다.
   */
  microphonePermission: MediaPermissionState
  /** 방 전체를 다시 연결한다. 연결이 진짜로 끊겼을 때만 쓴다. */
  retry: () => void
  /** 장치만 다시 연다. 방은 그대로 두므로 강의 중에도 안전하다. */
  retryMedia: () => void
  /** 장치 안내를 닫는다. 원인을 읽었으면 화면을 가리지 않게 한다. */
  dismissMediaFailure: () => void
  toggleCamera: () => void
  toggleMicrophone: () => void
  toggleScreenShare: () => void
  /** 지금 데모 파일을 송출 중인가(ADR-0100). 화면이 그 사실을 숨기지 않도록 내준다. */
  demoPublish: DemoPublishState & { hasAudio: boolean }
  /** 장치를 내리고 이 파일로 갈아탄다. */
  startDemoPublish: (file: File) => void
  /** 데모를 끄고 평소 장치로 돌아간다. */
  stopDemoPublish: () => void
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

/** 사전 점검의 소리 게이지가 읽는 트랙. 음소거면 잴 소리가 없으므로 내주지 않는다. */
function getLocalMicrophoneTrack(room: Room) {
  const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
  if (!publication || publication.isMuted) return undefined
  return publication.audioTrack instanceof LocalAudioTrack ? publication.audioTrack : undefined
}

/**
 * 실패 시점의 권한을 읽어 원인을 확정한다. 권한 조회는 창을 띄우지 않으므로 실패 직후에 해도 안전하다.
 *
 * <p>화면 공유에는 저장된 사이트 권한이 없다(매번 선택 창이다). 그래서 조회하지 않는다.
 */
async function resolveMediaFailure(error: unknown, kind: MediaKind): Promise<MediaFailure> {
  if (kind === 'screenShare') return describeMediaFailure(error, kind)
  const permission = await queryMediaPermission(kind)
  return describeMediaFailure(error, kind, permission)
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
/**
 * 대역이 모자랄 때 무엇을 포기할지.
 *
 * <p>지정하지 않으면 브라우저 기본값이 트랙 종류로 갈린다 — 카메라는 `maintain-framerate`라
 * <b>해상도를 먼저 버린다</b>. 그런데 학생은 카메라를 직접 구독하지 않고 Egress 합성본을
 * 보므로(ADR-0032), 해상도가 떨어지면 <b>Egress가 그걸 1080p 캔버스로 확대해 인코딩한다</b>.
 * 사이멀캐스트를 껐던 이유(640x360을 3배 확대해 내보내고 있었다)와 같은 결과다.
 *
 * <p><b>우리는 프레임률을 버리는 쪽이 이득이다.</b> Egress가 어차피 15fps로 내보내므로 카메라가
 * 30에서 15로 깎여도 결과물에서 잃는 것이 없다. 반면 해상도 저하는 그대로 흐려짐이 된다.
 *
 * <p>강사는 이 저하를 알아챌 수 없다는 점이 중요하다 — 미리보기는 인코딩 전 로컬 원본이라
 * 업링크가 모자라도 강사 화면은 멀쩡하다. 강사가 눈치채고 화질을 낮춰 주기를 기대할 수 없으므로,
 * 깎일 때 덜 아픈 쪽으로 깎이도록 미리 정해 둔다.
 */
const DEGRADE_KEEPING_RESOLUTION = 'maintain-resolution' as const

function cameraPublishArgs(quality: PublishQuality) {
  const preset = cameraPreset(quality)
  return {
    capture: { resolution: preset.resolution },
    publish: {
      videoEncoding: preset.encoding,
      simulcast: false,
      degradationPreference: DEGRADE_KEEPING_RESOLUTION,
    },
  } as const
}

/**
 * 데모 파일을 카메라·마이크 <b>자리에</b> 올린다(ADR-0100).
 *
 * <p><b>`source`가 계약이다.</b> STT agent는 `SOURCE_MICROPHONE`인 오디오만 강사 발화로 본다
 * (`audio_source.py`). 그냥 올리면 source가 `UNKNOWN`이 되고, 그러면 <b>영상과 녹화는 멀쩡한데
 * 자막만 영영 안 뜬다</b> — 자막이 없으면 강의 노트도 AI 근거도 빈 채로 간다. 조용히 실패하는
 * 종류라 여기 적어 둔다. 카메라도 같다: `SOURCE_CAMERA`여야 Egress 합성이 카메라 자리에 놓는다.
 *
 * <p>`capture` 인자는 넘기지 않는다 — getUserMedia 제약이라 파일에는 걸리지 않는다. 대신 `publish`
 * (인코딩·사이멀캐스트·열화 우선순위)는 그대로 적용된다. 그래서 해상도만 파일 원본을 따른다.
 */
async function publishDemoTracks(room: Room, quality: PublishQuality): Promise<void> {
  const { video, audio } = await createDemoTracks()
  await room.localParticipant.publishTrack(video, {
    source: Track.Source.Camera,
    ...cameraPublishArgs(quality).publish,
  })
  if (audio) {
    await room.localParticipant.publishTrack(audio, { source: Track.Source.Microphone })
  }
}

/** 데모 송출 실패도 장치 실패와 같은 자리에 그린다 — 강사가 볼 곳이 하나여야 한다. */
function demoMediaFailure(error: unknown): MediaFailure {
  const ready = demoPublishState().ready
  return {
    kind: 'camera',
    cause: 'unknown',
    title: ready ? '데모 영상을 송출하지 못했습니다' : '데모 영상이 없습니다',
    detail: ready
      ? error instanceof Error ? error.message : '알 수 없는 오류입니다.'
      : '새로고침하면 선택한 파일이 사라집니다. 카메라로 자동 전환하지 않았습니다.',
    action: '데모 영상을 다시 선택하거나, 데모를 끄고 카메라로 진행해 주세요.',
    // 브라우저 설정으로 풀리는 문제가 아니다. 파일을 다시 고르면 되므로 재시도는 내준다.
    retryable: true,
    needsBrowserSetting: false,
  }
}

function screenPublishArgs(quality: PublishQuality) {
  const preset = screenPreset(quality)
  return {
    capture: { resolution: preset.resolution },
    publish: {
      videoEncoding: preset.encoding,
      simulcast: false,
      // 화면공유는 브라우저 기본값이 이미 maintain-resolution이지만 명시한다. 기본값에 기대면
      // 트랙 종류 판정이 달라지는 순간(브라우저·SDK 갱신) 조용히 바뀌는데, 바뀌어도 강사는
      // 알 수 없다. 코드·슬라이드에서 해상도 저하는 곧 글자 판독 실패다.
      degradationPreference: DEGRADE_KEEPING_RESOLUTION,
    },
  } as const
}

/**
 * preflight와 classroom이 공유하는 session-scoped LiveKit Room 소유자(ADR-0002 §1).
 *
 * <p>이 Provider는 두 페이지의 공통 route 부모에 mount된다. 따라서 preflight → classroom 전환은
 * Room/track을 끊지 않고, 다른 세션이나 종료 후 강의 상세처럼 이 route 밖으로 나갈 때만 cleanup한다.
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
  const [microphonePermission, setMicrophonePermission] = useState<MediaPermissionState>('unknown')
  /** 데모 송출 상태. 화면이 배지를 띄우고 강사가 끌 수 있게 하는 근거다(ADR-0100). */
  const [demoState, setDemoState] = useState<DemoPublishState>(demoPublishState)
  // Room 생성 effect가 품질 변경마다 재실행되면 연결이 끊긴다. 최신 값은 ref로만 읽고,
  // 이미 올라간 트랙은 재게시로 반영한다.
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const [cameraOverlay, setCameraOverlay] = useState<CameraOverlay>(DEFAULT_CAMERA_OVERLAY)
  const overlayRef = useRef(cameraOverlay)
  overlayRef.current = cameraOverlay

  /**
   * 좌우 뒤집기를 켜고 끈다. <b>강사 화면과 Egress에 동시에</b> 반영해야 한다.
   *
   * <p>웹캠은 뒤집고 파일은 뒤집지 않는다(ADR-0100) — 미리 녹화한 영상은 거울상이 아니라서,
   * 뒤집으면 화면 속 글자가 반전된 채 <b>녹화·VOD에 영구히 남는다</b>. 강사 화면만 고치면 강사는
   * 멀쩡해 보이는데 수강생만 반전을 본다.
   *
   * <p>드래그용 발행({@link flushCameraOverlay})과 달리 프레임으로 묶지 않는다 — 이건 송출을 켜고
   * 끌 때 한 번씩만 일어나므로 묶을 것이 없고, 곧바로 나가야 첫 프레임부터 방향이 맞는다.
   */
  const applyOverlayMirrored = useCallback(async (room: Room | null, mirrored: boolean) => {
    const merged = clampOverlay({ ...overlayRef.current, mirrored })
    overlayRef.current = merged
    setCameraOverlay(merged)
    if (!room || room.state !== 'connected') return
    const participant = room.localParticipant
    await participant
      .setMetadata(withCameraOverlay(participant.metadata, merged))
      .catch((error) => { console.warn('카메라 방향을 합성 화면에 전달하지 못했습니다', error) })
  }, [])

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
      microphoneTrack: getLocalMicrophoneTrack(room),
      mediaRevision: current.mediaRevision + 1,
    }))
  }, [])

  /**
   * 지금 걸려 있는 장치 실패. <b>상태와 같은 순간에</b> 쓴다.
   *
   * <p>예전에는 effect로 state를 뒤따라 복사했는데, 그러면 권한 변화 같은 <b>이벤트가 그 사이에</b>
   * 끼어들 때 아직 갱신되지 않은 값을 보고 자동 재시도가 그냥 지나간다. 화면이 이미 "차단됨"을
   * 그리고 있는데 허용으로 바꿔도 마이크가 안 켜지는, 재현하기 어려운 종류의 사고다.
   */
  const mediaFailureRef = useRef<MediaFailure | undefined>(undefined)
  const setMediaFailure = useCallback((failure?: MediaFailure) => {
    mediaFailureRef.current = failure
    setState((current) => ({ ...current, mediaFailure: failure }))
  }, [])

  /**
   * 마이크·카메라를 연다. <b>방은 건드리지 않는다.</b>
   *
   * <p>장치가 안 열려도 강사는 이미 방 안에 있다. 끊어 버리면 (1) 원인이 장치라는 사실이 가려지고
   * (2) 마이크만 다시 시도할 길이 없어져 전체 재연결밖에 남지 않는다.
   *
   * <p>요청하기 전에 권한과 장치 존재를 먼저 본다. 차단된 상태에서 요청을 보내면 브라우저가
   * 조용히 거절해 강사 눈에는 화면이 멈춘 것처럼 보인다.
   */
  const openLocalDevices = useCallback(async (room: Room, kinds: MediaKind[]) => {
    // 방이 바뀌었으면(재연결·언마운트) 결과를 반영하지 않는다.
    const alive = () => roomRef.current === room
    const wantsMicrophone = kinds.includes('microphone')
    setMediaFailure(undefined)

    /*
     * 데모로 무장돼 있으면 장치를 아예 건드리지 않는다(ADR-0100). 권한도 묻지 않는다 — 물어 봐야
     * 쓰지 않을 장치이고, 시연 중에 권한 창이 뜨는 것 자체가 사고다.
     *
     * 파일을 잃었으면(새로고침) 아무것도 올리지 않고 그렇다고 말한다. 진짜 카메라로 조용히
     * 되돌아가면 발표자의 실제 방이 수강생 화면에 뜬다.
     */
    if (demoPublishState().armed) {
      try {
        await publishDemoTracks(room, qualityRef.current)
        // 파일은 거울상이 아니다. 트랙을 올리자마자 방향을 알려 첫 프레임부터 맞춘다.
        await applyOverlayMirrored(room, false)
      } catch (error) {
        if (!alive()) return
        setMediaFailure(demoMediaFailure(error))
      }
      if (alive()) syncLocalState(room)
      return
    }

    if (wantsMicrophone) {
      const [permission, present] = await Promise.all([
        queryMediaPermission('microphone'),
        hasInputDevice('microphone'),
      ])
      if (!alive()) return
      setMicrophonePermission(permission)

      const foreseen = preflightMediaFailure('microphone', permission, present)
      if (foreseen) {
        setMediaFailure(foreseen)
      } else {
        try {
          await room.localParticipant.setMicrophoneEnabled(true)
        } catch (error) {
          const failure = await resolveMediaFailure(error, 'microphone')
          if (!alive()) return
          setMediaFailure(failure)
        }
      }
      if (!alive()) return
    }

    if (kinds.includes('camera')) {
      try {
        await room.localParticipant.setCameraEnabled(true)
      } catch (error) {
        const failure = await resolveMediaFailure(error, 'camera')
        // 마이크 안내를 덮지 않는다. 라이브 시작을 막는 것은 마이크뿐이라 그쪽을 먼저 읽어야 한다.
        if (alive() && !mediaFailureRef.current) setMediaFailure(failure)
      }
    }

    if (alive()) syncLocalState(room)
  }, [applyOverlayMirrored, setMediaFailure, syncLocalState])

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
        // 스크롤 구간에서 글자가 뭉갠다. 우리 프리셋은 같은 1080p30에 8Mbps다(publishQuality.ts).
        screenShareEncoding: screenPreset(qualityRef.current).encoding,
        // 대역이 모자랄 때 해상도가 아니라 프레임률을 버린다. 카메라 기본값은 반대(maintain-framerate)라
        // 반드시 명시해야 한다 — 해상도가 떨어지면 Egress가 확대해 인코딩하고, 강사는 로컬 원본을
        // 보고 있어 알아채지 못한다. 자세한 근거는 cameraPublishArgs 위 주석.
        degradationPreference: DEGRADE_KEEPING_RESOLUTION,
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
        // 어느 장치인지 이벤트가 알려 주지 않는다. 마이크가 필수 게이트라 그쪽으로 본다.
        void resolveMediaFailure(error, 'microphone').then((failure) => {
          if (!cancelled) setMediaFailure(failure)
        })
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
        /*
         * 장치 여는 일은 여기서 끝난다 — 아래 catch로 새어 나가면 방을 끊고 "연결 실패"라고 말하게
         * 된다. 마이크가 없는 컴퓨터에서 실제로 그랬다. 방은 이미 붙어 있으므로 끊을 이유가 없고,
         * 강사에게 필요한 것은 장치 안내다.
         */
        await openLocalDevices(room, ['microphone', 'camera'])
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
      // 재생 중인 element를 놓아 준다. 안 놓으면 이 route를 떠난 뒤에도 파일이 계속 돌며 소리가 난다.
      releaseDemoTracks()
    }
  }, [openLocalDevices, retryCount, sessionId, setMediaFailure, syncLocalState])

  /**
   * 권한과 장치 목록의 변화를 지켜본다.
   *
   * <p>강사가 사이트 설정에서 마이크를 허용하거나 마이크를 꽂으면 <b>새로고침 없이</b> 다시 시도한다.
   * 반대로 "이번만 허용"이 끝나면 브라우저가 마이크를 끊는데, 그때 아무 말이 없으면 강사는 자기
   * 목소리가 안 나가는 줄도 모른 채 강의를 계속하게 된다.
   *
   * <p>자동 재시도는 <b>우리가 마이크 실패를 보고해 둔 경우로만</b> 제한한다. 그러지 않으면 강사가
   * 일부러 끈 마이크를 이어폰 연결 같은 사건이 제멋대로 다시 켠다.
   */
  useEffect(() => {
    if (!sessionId || isMockApiEnabled) return

    const retryMicrophone = () => {
      const room = roomRef.current
      if (!room || room.state !== 'connected') return
      if (mediaFailureRef.current?.kind !== 'microphone') return
      void openLocalDevices(room, ['microphone'])
    }

    const stopWatching = watchMediaPermission('microphone', (next) => {
      setMicrophonePermission(next)
      const room = roomRef.current
      if (next === 'granted') {
        retryMicrophone()
        return
      }
      // 허용이 걷혔다. 송출 중이었다면 브라우저가 트랙을 끊은 상태다.
      if (room?.state === 'connected' && room.localParticipant.isMicrophoneEnabled) {
        setMediaFailure(describeMediaFailure({ name: 'NotAllowedError' }, 'microphone', next))
      }
    })

    const devices = navigator.mediaDevices
    devices?.addEventListener?.('devicechange', retryMicrophone)
    return () => {
      stopWatching()
      devices?.removeEventListener?.('devicechange', retryMicrophone)
    }
  }, [openLocalDevices, sessionId, setMediaFailure])

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
    setMediaFailure(undefined)
    try {
      /*
       * 데모 중에는 카메라·마이크를 <b>음소거로</b> 끈다. `setCameraEnabled(true)`를 태우면 LiveKit이
       * 장치를 새로 여는데, 그러면 <b>발표자의 진짜 카메라가 켜진다</b> — 시연 중에 이보다 나쁜
       * 사고가 없다. 음소거는 publication을 그대로 두므로 `isCameraEnabled` 판정도 그대로 맞는다.
       */
      if (demoPublishState().armed && control !== 'screenShare') {
        const source = control === 'camera' ? Track.Source.Camera : Track.Source.Microphone
        const publication = room.localParticipant.getTrackPublication(source)
        if (publication) {
          if (publication.isMuted) await publication.unmute()
          else await publication.mute()
        }
        syncLocalState(room)
        return
      }
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
      const failure = await resolveMediaFailure(error, control)
      // 공유 대상 선택 창을 닫은 것은 실패가 아니다. 예전에는 이때 "권한이 거부되었습니다"가 떴다.
      if (failure.cause !== 'canceled') setMediaFailure(failure)
      if (control === 'microphone') setMicrophonePermission(await queryMediaPermission('microphone'))
    } finally {
      setPendingControl(null)
    }
  }, [pendingControl, setMediaFailure, state.connectionState, syncLocalState])

  /**
   * 실패한 장치만 다시 연다. <b>방은 그대로 둔다</b> — 강의 중에도 안전해야 하기 때문이다.
   *
   * <p>전체 재연결(`retry`)과 다르다. 마이크가 안 잡히는 것과 서버에 못 붙는 것은 다른 사건이고,
   * 고치는 방법도 다르다.
   */
  const retryMedia = useCallback(() => {
    const room = roomRef.current
    const kind = state.mediaFailure?.kind
    if (!room || room.state !== 'connected' || !kind) return
    if (kind === 'screenShare') {
      void toggleControl('screenShare')
      return
    }
    void openLocalDevices(room, [kind])
  }, [openLocalDevices, state.mediaFailure?.kind, toggleControl])

  /**
   * 장치를 내리고 데모 파일로 갈아탄다(ADR-0100).
   *
   * <p><b>먼저 내리는 것이 중요하다.</b> 진짜 카메라를 올려 둔 채 파일을 또 올리면 카메라 트랙이
   * 둘이 되고, Egress는 소스별로 element가 하나뿐이라 둘이 서로 덮는다. 마이크가 둘이면 더 나쁘다 —
   * STT agent가 `multiple remote microphone publishers`로 트랙을 죽여 자막이 통째로 사라진다.
   */
  const startDemoPublish = useCallback(async (file: File) => {
    const room = roomRef.current
    setPendingControl('initial')
    setMediaFailure(undefined)
    try {
      armDemoPublish(file)
      if (room && room.state === 'connected') {
        await room.localParticipant.setCameraEnabled(false)
        await room.localParticipant.setMicrophoneEnabled(false)
        await publishDemoTracks(room, qualityRef.current)
        await applyOverlayMirrored(room, false)
        syncLocalState(room)
      }
      setDemoState(demoPublishState())
    } catch (error) {
      setMediaFailure(demoMediaFailure(error))
      setDemoState(demoPublishState())
    } finally {
      setPendingControl(null)
    }
  }, [applyOverlayMirrored, setMediaFailure, syncLocalState])

  /** 데모를 끄고 평소 장치로 돌아간다. 시연 뒤 정리이자, 잘못 켰을 때의 탈출구다. */
  const stopDemoPublish = useCallback(async () => {
    const room = roomRef.current
    setPendingControl('initial')
    try {
      if (room && room.state === 'connected') {
        for (const source of [Track.Source.Camera, Track.Source.Microphone]) {
          const track = room.localParticipant.getTrackPublication(source)?.track
          if (track) await room.localParticipant.unpublishTrack(track)
        }
      }
      disarmDemoPublish()
      setDemoState(demoPublishState())
      // 웹캠으로 돌아가면 다시 거울이다. 되돌리지 않으면 강사가 자기 얼굴을 뒤집힌 채로 본다.
      await applyOverlayMirrored(room, true)
      if (room && room.state === 'connected') await openLocalDevices(room, ['microphone', 'camera'])
    } finally {
      setPendingControl(null)
    }
  }, [applyOverlayMirrored, openLocalDevices])

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
      setMediaFailure(undefined)
      setState((current) => ({ ...current, notice: undefined }))
      try {
        if (next.camera && room.localParticipant.isCameraEnabled) {
          if (demoPublishState().armed) {
            /*
             * 데모는 껐다 켤 수 없다 — `setCameraEnabled(true)`가 진짜 카메라를 연다. 대신 트랙을
             * 내리고 파일에서 다시 뽑아 올린다.
             *
             * <b>해상도는 안 바뀐다.</b> `capture` 제약은 getUserMedia 전용이라 파일에는 걸리지
             * 않고, 바뀌는 것은 인코딩 비트레이트뿐이다. 그래서 그렇다고 말해 준다 — 화면만 보면
             * 적용된 것처럼 보이는 종류다.
             */
            const published = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
            if (published) await room.localParticipant.unpublishTrack(published)
            await publishDemoTracks(room, merged)
            setState((current) => ({
              ...current,
              notice: '데모 송출은 영상 파일의 해상도를 따릅니다. 전송 비트레이트만 바뀝니다.',
            }))
          } else {
            const { capture, publish } = cameraPublishArgs(merged)
            await room.localParticipant.setCameraEnabled(false)
            await room.localParticipant.setCameraEnabled(true, capture, publish)
          }
        }
        if (next.screenShare && room.localParticipant.isScreenShareEnabled) {
          // 화면공유는 다시 올리면 브라우저가 공유 대상을 새로 묻는다. 강사가 강의 도중
          // 예기치 않게 선택 창을 만나지 않도록, 켜져 있으면 다음 공유부터 적용한다.
          //
          // 이건 알림이지 오류가 아니다. 예전에는 오류 칸에 담겨 붉은 경고로 떴다.
          setState((current) => ({ ...current, notice: '화면공유 화질은 공유를 다시 시작할 때 적용됩니다.' }))
        }
        syncLocalState(room)
      } catch (error) {
        const failure = await resolveMediaFailure(error, next.screenShare ? 'screenShare' : 'camera')
        setMediaFailure(failure)
      } finally {
        setApplyingQuality(false)
      }
    }
    void republish()
  }, [setMediaFailure, state.connectionState, syncLocalState])

  /** 아직 보내지 않은 최신 배치와, 그것을 보낼 프레임. 레이저와 같은 장치다. */
  const overlayPendingRef = useRef<CameraOverlay | null>(null)
  const overlayFrameRef = useRef(0)

  /**
   * 카메라 배치를 강사 participant metadata에 쓴다. Egress 템플릿이 이 값을 읽어 합성하므로
   * 강사가 미리보기에서 옮긴 자리가 그대로 수강생 녹화가 된다.
   *
   * <p>화면은 즉시 갱신하고 metadata 전송은 뒤따르게 한다 — 드래그 중에 서버 왕복을 기다리면
   * 화면이 손가락을 따라오지 못한다. 전송이 실패해도 미리보기는 그대로 두고, 다음 조작 때
   * 최신 값이 다시 나간다(마지막 값이 이긴다).
   *
   * <p><b>발행은 프레임당 한 번으로 묶는다</b>(레이저와 같은 이유·같은 방식,
   * {@link InstructorAnnotationLayer}). 예전에는 `pointermove`마다 그대로 보냈는데, 그러면 두 가지가
   * 생긴다.
   *
   * <ol>
   *   <li>드래그 내내 트랙 publish·재연결과 <b>같은 시그널 채널</b>을 초당 수십 건으로 점유한다.</li>
   *   <li>livekit-client는 서버가 <b>자기가 보낸 문자열과 똑같은 값</b>을 되돌려줄 때만 resolve하고
   *       5초 동안 50ms 간격으로 폴링한다. 중간값은 곧바로 다음 값에 덮이므로 <b>구조적으로 절대
   *       resolve되지 않고</b>, 드래그 한 번이 timeout 수십 개를 만든다. 실제로 운영 콘솔에서
   *       그 경고가 진짜 오류(백엔드 다운)를 밀어냈다.</li>
   * </ol>
   *
   * <p><b>마지막 값은 반드시 나간다.</b> 매 호출이 최신 값을 `pending`에 덮어쓰고, 프레임이 이미
   * 잡혀 있으면 그것을 기다린다 — 프레임이 지난 뒤에 온 호출은 새 프레임을 잡는다. 그래서 어느
   * 시점에 손을 떼도 마지막 배치가 한 프레임 안에 발행된다. 이걸 leading-edge throttle로 만들면
   * 마지막 값이 버려져 <b>합성 화면이 중간 위치에서 멈춘다</b>.
   */
  const flushCameraOverlay = useCallback(() => {
    overlayFrameRef.current = 0
    const merged = overlayPendingRef.current
    overlayPendingRef.current = null
    const room = roomRef.current
    // 프레임을 기다리는 사이 끊겼을 수 있다. 재연결하면 그쪽에서 현재 배치를 다시 낸다.
    if (!merged || !room || room.state !== 'connected') return
    const participant = room.localParticipant
    void participant
      .setMetadata(withCameraOverlay(participant.metadata, merged))
      .catch((error) => {
        console.warn('카메라 배치를 합성 화면에 전달하지 못했습니다', error)
      })
  }, [])

  const moveCameraOverlay = useCallback((next: Partial<CameraOverlay>) => {
    const merged = clampOverlay({ ...overlayRef.current, ...next })
    overlayRef.current = merged
    setCameraOverlay(merged)

    const room = roomRef.current
    if (!room || state.connectionState !== 'connected') return
    overlayPendingRef.current = merged
    if (overlayFrameRef.current === 0) {
      overlayFrameRef.current = requestAnimationFrame(flushCameraOverlay)
    }
  }, [flushCameraOverlay, state.connectionState])

  // 떠날 때 잡아 둔 프레임을 놓아준다. 남겨 두면 언마운트된 뒤에 발행이 돈다.
  useEffect(() => () => {
    if (overlayFrameRef.current !== 0) cancelAnimationFrame(overlayFrameRef.current)
  }, [])

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

  /**
   * 복원 체크포인트를 저장한다(ADR-0057).
   *
   * <p>이것이 없으면 복원이 세션 시작부터 전부 내려온다 — 실측에서 op 233건이 983kB였고 강의가
   * 길어질수록 무한히 자란다. ADR-0055에서 복원 시딩을 스냅샷 → 포인터로 바꾸며 생긴 부작용이다.
   *
   * <p>실패해도 조용히 넘어간다. 체크포인트는 복원을 <b>빠르게</b> 하는 장치지 복원의 조건이 아니다 —
   * 없으면 그냥 전부 접는다.
   */
  const saveAnnotationSnapshot = useCallback((snapshot: () => AnnotationChange) => {
    const revision = annotationRevisionRef.current
    if (revision <= 0) return
    const body = snapshot()
    void (async () => {
      try {
        const response = await fetch(`/api/live-sessions/${sessionId}/annotation/snapshot`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(await resolveCsrfHeader()) },
          body: JSON.stringify({
            revision,
            // op와 같은 형태로 담는다 — 복원 fold가 snapshot op와 똑같이 다룬다.
            payload: JSON.stringify({ elements: body.type === 'snapshot' ? body.elements : [], files: body.type === 'snapshot' ? body.files ?? {} : {} }),
          }),
        })
        if (!response.ok) throw new Error(`체크포인트 저장 실패: ${response.status}`)
      } catch (error) {
        console.warn('판서 복원 체크포인트를 남기지 못했습니다(복원이 느려질 뿐입니다)', error)
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
    demoPublish: { ...demoState, hasAudio: demoHasAudio() },
    startDemoPublish: (file: File) => { void startDemoPublish(file) },
    stopDemoPublish: () => { void stopDemoPublish() },
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
    saveAnnotationSnapshot,
    applyingQuality,
    microphonePermission,
    retry: () => setRetryCount((current) => current + 1),
    retryMedia,
    dismissMediaFailure: () => setMediaFailure(undefined),
    toggleCamera: () => { void toggleControl('camera') },
    toggleMicrophone: () => { void toggleControl('microphone') },
    toggleScreenShare: () => { void toggleControl('screenShare') },
  }), [annotationAudienceRevision, applyingQuality, cameraOverlay, changeQuality, demoState, microphonePermission, moveCameraOverlay, pendingControl, publishAnnotation, publishAnnotationState, publishLaser, quality, restoredAnnotation, restoredAnnotationVisible, retryMedia, saveAnnotationSnapshot, saveAnnotationVisible, sessionId, setMediaFailure, startDemoPublish, state, stopDemoPublish, toggleControl])

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
