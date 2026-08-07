import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  RemoteAudioTrack,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client'
import {
  DEFAULT_CAMERA_OVERLAY,
  overlayHeight,
  parseCameraOverlay,
  type CameraOverlay,
} from '@/features/live-session/cameraOverlay'
import EgressAnnotationLayer from '@/features/live-session/EgressAnnotationLayer'
import '@/styles/egress-stage.css'

/**
 * 자동재생이 막혔을 때 `startAudio()`를 다시 부르는 횟수 상한. 같은 정책에 계속 막히는 상황에서
 * 무한히 재시도하면 Egress CPU만 갉아먹으므로, 몇 번 시도한 뒤 콘솔에 원인을 남기고 멈춘다.
 */
const MAX_AUDIO_RECOVERY_ATTEMPTS = 5

/**
 * Egress 합성 화면. 사람이 보는 페이지가 아니라 <b>Egress의 헤드리스 Chrome이 여는 캔버스</b>다.
 *
 * <p>LiveKit 기본 템플릿은 화면공유와 카메라를 나란히 놓아, 1920 폭 화면공유가 1587로 축소되고
 * 좌하단에 쓰지 않는 검은 영역이 남는다(운영 프레임 실측). 수강생은 그렇게 줄어든 화면을 다시
 * 확대해서 본다. 그래서 우리 템플릿으로 바꾼다 — 화면공유가 캔버스를 채우고 카메라는 그 위에 얹는다.
 *
 * <p><b>Egress와의 계약</b>: {@code {customBaseUrl}?url=&token=&layout=} 로 열리고, 페이지가
 * 준비되면 콘솔에 {@code START_RECORDING}을, 끝나면 {@code END_RECORDING}을 찍는다. Egress는
 * Chrome 콘솔 출력을 감시한다(egress v1.13.0 {@code source/web.go} 로그에서 확인).
 *
 * <p><b>가볍게 유지할 것.</b> 렌더링 비용이 그대로 Egress CPU다. 그림자·블러·트랜지션을 넣지 않는다.
 *
 * <p><b>카메라는 좌우를 뒤집어 합성한다</b>(egress-stage.css). 강사는 자기 카메라를 거울로 보고 그
 * 화면을 기준으로 움직이므로, 원본 그대로 합성하면 수강생만 좌우가 반대로 보인다. 화면공유는 글자가
 * 읽혀야 하므로 뒤집지 않는다 — 뒤집기는 카메라 element에만 걸린다.
 *
 * <p><b>오디오 계약 — 이 페이지가 소리를 내야 한다.</b> Egress는 트랙을 직접 믹스하지 않는다.
 * 헤드리스 Chrome의 <b>재생 출력</b>을 pulseaudio 가상 싱크로 받아 인코딩한다. 즉 <b>이 페이지가
 * 스피커로 내보내지 않은 소리는 존재하지 않는다</b> — HLS도 녹화도 무음이 된다. 수강생은
 * ADR-0032에 따라 LiveKit을 직접 구독하지 않고 이 합성 결과만 보므로, 여기서 빠진 오디오는
 * 어디에서도 복구되지 않는다.
 *
 * <p>그래서 규칙은 둘이다.
 * <ul>
 *   <li><b>오디오 element에는 절대 {@code muted}를 걸지 않는다.</b> 원격 오디오 트랙은 전용
 *       {@code <audio>}(화면 밖 싱크)로 재생한다. 이 페이지는 사람이 보지 않으니 "실수로 소리가
 *       난다"는 위험이 없고, 반대로 음소거는 곧 강의 전체가 무음이 되는 사고다.</li>
 *   <li><b>{@code <video>}의 {@code muted}는 유지한다.</b> 비디오 트랙에는 오디오가 실려 있지
 *       않아(LiveKit은 오디오를 별도 트랙으로 퍼블리시한다) 음소거가 소리를 지우지 않는다. 오히려
 *       muted가 없으면 자동재생 정책에 막혀 <b>화면까지</b> 멈출 수 있다. 소리와 그림의 자동재생
 *       조건을 분리해, 오디오가 막혀도 영상은 계속 나가게 한다.</li>
 * </ul>
 *
 * <p><b>자동재생</b>: Egress의 Chrome은 {@code --autoplay-policy=no-user-gesture-required}로
 * 뜬다(LiveKit 기본 템플릿도 제스처 없는 오디오 재생에 의존한다). 그래도 그 전제가 깨지면 무음이
 * 조용히 녹화되므로, 차단이 감지되면({@code AudioPlaybackStatusChanged}) {@code room.startAudio()}로
 * element 음소거 해제와 AudioContext resume을 다시 시도하고, 끝내 실패하면 콘솔에 남긴다 — Egress가
 * 이미 감시하는 그 콘솔이 사후 진단의 유일한 창구다.
 */
export default function EgressStagePage() {
  const [params] = useSearchParams()
  const url = params.get('url') ?? ''
  const token = params.get('token') ?? ''

  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const audioSinkRef = useRef<HTMLDivElement>(null)
  const [overlay, setOverlay] = useState<CameraOverlay>(DEFAULT_CAMERA_OVERLAY)
  const [hasScreen, setHasScreen] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)
  // 판서 레이어가 데이터 채널을 구독하려면 Room이 필요하다(ADR-0051).
  const [connectedRoom, setConnectedRoom] = useState<Room | null>(null)

  useEffect(() => {
    if (!url || !token) return undefined

    const room = new Room({ adaptiveStream: false, dynacast: false })
    setConnectedRoom(room)
    let ended = false
    let audioRecoveryAttempts = 0
    const attachedAudio = new Set<RemoteAudioTrack>()

    const signalEnd = () => {
      if (ended) return
      ended = true
      // Egress가 이 줄을 보고 녹화를 마무리한다.
      console.log('END_RECORDING')
    }

    /**
     * 음소거 해제 + AudioContext resume을 재시도한다. 헤드리스 Chrome이
     * `--autoplay-policy=no-user-gesture-required`로 뜨는 한 첫 attach에서 이미 재생되지만,
     * 그 전제가 깨진 채 조용히 무음으로 녹화되는 쪽이 최악이라 복구 경로를 남겨 둔다.
     */
    const startAudio = () => {
      void room.startAudio().catch((error) => {
        console.error('egress stage 오디오 재생 시작 실패', error)
      })
    }

    const recoverAudioPlayback = () => {
      if (room.canPlaybackAudio) return
      if (audioRecoveryAttempts >= MAX_AUDIO_RECOVERY_ATTEMPTS) {
        // 더 시도해도 같은 정책에 막힌다. 무음 녹화의 원인을 콘솔에 확정적으로 남긴다.
        console.error('egress stage 오디오 자동재생이 차단됐다 — 합성 결과가 무음이 된다')
        return
      }
      audioRecoveryAttempts += 1
      startAudio()
    }

    /**
     * 원격 오디오는 전용 element로 재생한다. 인자 없는 `attach()`가 새 media element를 만들고
     * `autoplay`를 켜고 (오디오 트랙이 실려 있으므로) 음소거를 해제한 뒤 `play()`까지 부른다.
     * 우리가 하는 일은 그 element를 화면 밖 싱크에 꽂아 재생을 유지하는 것뿐이다 —
     * <b>여기서 muted를 건드리면 강의 전체가 무음이 된다.</b>
     *
     * 소스를 화이트리스트로 좁히지 않는다. 강사 마이크(Microphone)와 화면공유 오디오
     * (ScreenShareAudio)가 지금의 두 소스지만, 목록에서 빠진 소스는 곧 "들리지 않는 소리"이고
     * 그게 정확히 이 버그였다. 원격 오디오면 전부 합성에 싣는다.
     */
    const attachAudio = (track: RemoteAudioTrack) => {
      const sink = audioSinkRef.current
      if (!sink) return
      const element = track.attach()
      sink.append(element)
      attachedAudio.add(track)
      startAudio()
    }

    const detachAudio = (track: RemoteAudioTrack) => {
      for (const element of track.detach()) element.remove()
      attachedAudio.delete(track)
    }

    const attach = (track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (track instanceof RemoteAudioTrack) {
        attachAudio(track)
        return
      }
      if (!(track instanceof RemoteVideoTrack)) return
      if (publication.source === Track.Source.ScreenShare) {
        if (screenRef.current) track.attach(screenRef.current)
        setHasScreen(true)
      }
      if (publication.source === Track.Source.Camera) {
        if (cameraRef.current) track.attach(cameraRef.current)
        setHasCamera(true)
      }
    }

    const detach = (track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (track instanceof RemoteAudioTrack) {
        detachAudio(track)
        return
      }
      track.detach()
      if (publication.source === Track.Source.ScreenShare) setHasScreen(false)
      if (publication.source === Track.Source.Camera) setHasCamera(false)
    }

    // 배치는 강사 participant의 metadata에 실린다. 강사 브라우저가 직접 쓸 수 있어(CanUpdateOwnMetadata)
    // 백엔드 왕복 없이 드래그가 곧바로 합성에 반영된다. 카메라를 올린 참가자를 강사로 본다.
    const syncOverlay = () => {
      for (const participant of room.remoteParticipants.values()) {
        if (participant.getTrackPublication(Track.Source.Camera)
          || participant.getTrackPublication(Track.Source.ScreenShare)) {
          setOverlay(parseCameraOverlay(participant.metadata))
          return
        }
      }
    }

    room
      .on(RoomEvent.TrackSubscribed, attach)
      .on(RoomEvent.TrackUnsubscribed, detach)
      .on(RoomEvent.ParticipantMetadataChanged, syncOverlay)
      .on(RoomEvent.TrackPublished, syncOverlay)
      .on(RoomEvent.ParticipantConnected, syncOverlay)
      .on(RoomEvent.AudioPlaybackStatusChanged, recoverAudioPlayback)
      .on(RoomEvent.Disconnected, signalEnd)

    room
      .connect(url, token, { autoSubscribe: true })
      .then(() => {
        syncOverlay()
        // 트랙이 붙기 전에 AudioContext를 미리 확보해 둔다. 첫 오디오 트랙이 도착한 순간
        // 곧바로 소리가 나야 강의 앞부분이 무음으로 남지 않는다.
        startAudio()
        // 연결이 끝난 시점에 캔버스가 그려질 준비가 됐다. 트랙은 뒤늦게 붙어도 되고,
        // 강사가 아직 카메라를 켜지 않았을 수도 있다 — 그것 때문에 녹화 시작을 미루면
        // 강의 앞부분이 통째로 빠진다.
        console.log('START_RECORDING')
      })
      .catch((error) => {
        console.error('egress stage 연결 실패', error)
        signalEnd()
      })

    return () => {
      room
        .off(RoomEvent.TrackSubscribed, attach)
        .off(RoomEvent.TrackUnsubscribed, detach)
        .off(RoomEvent.ParticipantMetadataChanged, syncOverlay)
        .off(RoomEvent.TrackPublished, syncOverlay)
        .off(RoomEvent.ParticipantConnected, syncOverlay)
        .off(RoomEvent.AudioPlaybackStatusChanged, recoverAudioPlayback)
        .off(RoomEvent.Disconnected, signalEnd)
      // 오디오 element는 우리가 직접 만들어 붙였으니 React가 정리해 주지 않는다.
      for (const track of [...attachedAudio]) detachAudio(track)
      setConnectedRoom(null)
      void room.disconnect(true)
    }
  }, [token, url])

  // 화면공유가 없으면 카메라가 무대를 통째로 쓴다. 카메라만 켜고 진행하는 강의에서
  // 작은 PIP만 남고 나머지가 검게 비는 것을 막는다.
  const cameraIsStage = !hasScreen
  const cameraStyle = cameraIsStage
    ? undefined
    : {
      left: `${overlay.x * 100}%`,
      top: `${overlay.y * 100}%`,
      width: `${overlay.w * 100}%`,
      height: `${overlayHeight(overlay.w) * 100}%`,
    }

  return (
    <div className="egress-stage">
      <video
        ref={screenRef}
        className={`egress-stage__screen${hasScreen ? '' : ' is-hidden'}`}
        autoPlay
        muted
        playsInline
      />
      <video
        ref={cameraRef}
        className={
          `egress-stage__camera${cameraIsStage ? ' is-stage' : ''}`
          + `${hasCamera && overlay.visible ? '' : ' is-hidden'}`
          // 웹캠은 거울로, 파일 송출은 그대로. 강사 화면이 metadata로 알려 준다(ADR-0100) —
          // 여기서 틀리면 반전된 채로 HLS·녹화에 들어가 VOD에 영구히 남는다.
          + `${overlay.mirrored ? ' is-mirrored' : ''}`
        }
        style={cameraStyle}
        autoPlay
        muted
        playsInline
      />
      {/*
        판서는 카메라보다 위에 그린다 — 강사가 자료 위에 쓴 설명이 카메라 타일에 가려지면 안 된다.
        에디터가 아니라 렌더 결과만 얹으므로 선택 핸들이나 툴바는 존재하지 않는다(ADR-0051).
      */}
      <EgressAnnotationLayer room={connectedRoom} livekitToken={token} />
      {/*
        원격 오디오 element가 사는 자리. `display: none`이라 합성 프레임에는 한 픽셀도 남기지 않지만
        오디오 재생은 계속된다(LiveKit의 RoomAudioRenderer도 같은 방식이다). 여기 들어가는 element는
        `attach()`가 만들어 붙이므로 JSX에 `<audio>`를 미리 두지 않는다 — 트랙 수가 고정이 아니고,
        선언해 둔 element에 muted가 섞여 들어갈 여지를 아예 없앤다.
      */}
      <div ref={audioSinkRef} className="egress-stage__audio" aria-hidden="true" />
    </div>
  )
}
