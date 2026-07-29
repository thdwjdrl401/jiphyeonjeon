import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
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
import '@/styles/egress-stage.css'

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
 */
export default function EgressStagePage() {
  const [params] = useSearchParams()
  const url = params.get('url') ?? ''
  const token = params.get('token') ?? ''

  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const [overlay, setOverlay] = useState<CameraOverlay>(DEFAULT_CAMERA_OVERLAY)
  const [hasScreen, setHasScreen] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)

  useEffect(() => {
    if (!url || !token) return undefined

    const room = new Room({ adaptiveStream: false, dynacast: false })
    let ended = false

    const signalEnd = () => {
      if (ended) return
      ended = true
      // Egress가 이 줄을 보고 녹화를 마무리한다.
      console.log('END_RECORDING')
    }

    const attach = (track: RemoteTrack, publication: RemoteTrackPublication) => {
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
      track.detach()
      if (publication.source === Track.Source.ScreenShare) setHasScreen(false)
      if (publication.source === Track.Source.Camera) setHasCamera(false)
    }

    const syncOverlay = () => setOverlay(parseCameraOverlay(room.metadata))

    room
      .on(RoomEvent.TrackSubscribed, attach)
      .on(RoomEvent.TrackUnsubscribed, detach)
      .on(RoomEvent.RoomMetadataChanged, syncOverlay)
      .on(RoomEvent.Disconnected, signalEnd)

    room
      .connect(url, token, { autoSubscribe: true })
      .then(() => {
        syncOverlay()
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
        .off(RoomEvent.RoomMetadataChanged, syncOverlay)
        .off(RoomEvent.Disconnected, signalEnd)
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
        }
        style={cameraStyle}
        autoPlay
        muted
        playsInline
      />
    </div>
  )
}
