import { useEffect, useRef } from 'react'
import type { LocalVideoTrack } from 'livekit-client'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'
import CameraOverlayControl from './CameraOverlayControl'
import { useInstructorLiveKit, type InstructorLiveKitConnectionState } from './useInstructorLiveKit'

interface InstructorLiveKitStageProps {
  sessionId: string
  lessonTitle: string
  participantCount: number
  onRequestEnd: () => void
}

function LocalTrackVideo({ track, label, fit = 'cover', mirrored = false }: {
  track: LocalVideoTrack
  label: string
  fit?: 'cover' | 'contain'
  /** 자기 얼굴은 거울처럼 보여야 자연스럽다. 화면공유와 합성 미리보기는 뒤집지 않는다. */
  mirrored?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    track.attach(element)
    return () => { track.detach(element) }
  }, [track])

  return (
    <video
      aria-label={label}
      autoPlay
      className={`instructor-local-video instructor-local-video--${fit}${mirrored ? ' is-mirrored' : ''}`}
      muted
      playsInline
      ref={videoRef}
    />
  )
}

function connectionBadge(state: InstructorLiveKitConnectionState) {
  if (state === 'connected') return <StatusBadge tone="success">송출 연결됨</StatusBadge>
  if (state === 'mock') return <StatusBadge tone="warning">Mock 송출 모드</StatusBadge>
  if (state === 'connecting') return <StatusBadge>연결 중</StatusBadge>
  if (state === 'reconnecting') return <StatusBadge tone="warning">재연결 중</StatusBadge>
  if (state === 'error') return <StatusBadge tone="danger">연결 실패</StatusBadge>
  if (state === 'disconnected') return <StatusBadge tone="danger">연결 끊김</StatusBadge>
  return <StatusBadge>송출 대기</StatusBadge>
}

function emptyPreviewMessage(state: InstructorLiveKitConnectionState, cameraEnabled: boolean) {
  if (state === 'idle') return '녹화 안내를 확인하면 LiveKit 송출을 시작합니다.'
  if (state === 'connecting') return 'LiveKit 송출 서버에 연결하고 있습니다.'
  if (state === 'mock') return 'Mock API 모드에서는 실제 장치와 LiveKit 네트워크를 사용하지 않습니다.'
  if (state === 'error' || state === 'disconnected') return '송출 연결을 복구한 뒤 미리보기가 표시됩니다.'
  if (cameraEnabled) return '카메라 미리보기를 준비하고 있습니다.'
  return '카메라가 꺼져 있습니다. 카메라를 켜거나 화면을 공유해 주세요.'
}

export default function InstructorLiveKitStage({ sessionId, lessonTitle, participantCount, onRequestEnd }: InstructorLiveKitStageProps) {
  const publisher = useInstructorLiveKit()
  const screenShareTrack = publisher.screenShareEnabled ? publisher.screenShareTrack : undefined
  const cameraTrack = publisher.cameraEnabled ? publisher.cameraTrack : undefined
  const mainTrack = screenShareTrack ?? cameraTrack
  const showCameraPictureInPicture = Boolean(screenShareTrack && cameraTrack)
  const canRetry = publisher.connectionState === 'error' || publisher.connectionState === 'disconnected'

  return (
    <div className="video-stage video-stage--instructor" tabIndex={0}>
      <div className="video-stage__glow" />
      <div className="instructor-media-preview">
        {/*
          항상 contain으로 그린다. cover는 미리보기 영역 비율에 맞춰 영상을 잘라내는데, 합성 캔버스는
          자르지 않으므로 강사에게만 안 보이는 영역이 수강생에게는 보이게 된다. 잘리지 않는 대신
          레터박스가 생기지만, 실제로 나가는 화면과 같은 것을 보는 편이 낫다.
        */}
        {mainTrack
          ? (
            <LocalTrackVideo
              fit="contain"
              mirrored={!screenShareTrack}
              label={screenShareTrack ? '공유 화면 미리보기' : '카메라 미리보기'}
              track={mainTrack}
            />
          )
          : <div className="instructor-media-empty"><span aria-hidden="true">◉</span><strong>{emptyPreviewMessage(publisher.connectionState, publisher.cameraEnabled)}</strong></div>}
        {/*
          화면공유 위의 카메라는 단순 미리보기가 아니라 합성 화면의 편집기다. 여기서 옮긴 자리가
          그대로 수강생 녹화가 된다 — 미리보기와 Egress 템플릿이 같은 값(0~1 비율)을 읽는다.
        */}
        {showCameraPictureInPicture && cameraTrack && (
          <CameraOverlayControl
            overlay={publisher.cameraOverlay}
            onChange={publisher.moveCameraOverlay}
            disabled={!publisher.canControl}
          >
            <LocalTrackVideo label="카메라 미리보기" track={cameraTrack} />
          </CameraOverlayControl>
        )}
      </div>

      <header className="video-status-overlay" aria-label="라이브 강의 정보">
        <div className="video-status-overlay__identity"><span className="live-dot" /><strong>LIVE</strong><h1>{lessonTitle}</h1><small>강의 {sessionId}</small></div>
        <div className="video-status-overlay__status">
          <StatusBadge tone="warning">강사 운영 모드</StatusBadge>
          {connectionBadge(publisher.connectionState)}
          <span>{participantCount}명 참여 중</span>
          <button className="button button--soft button--small" type="button" onClick={onRequestEnd}>강의 종료</button>
        </div>
      </header>

      {publisher.errorMessage && (
        <div className="instructor-media-error" role="alert">
          <span>{publisher.errorMessage}</span>
          {canRetry && <button className="button button--soft button--small" type="button" onClick={publisher.retry}>다시 연결</button>}
        </div>
      )}

      <div className="video-controls-overlay" aria-label="강사 송출 컨트롤">
        <div className="control-row">
          <div>
            <button aria-pressed={publisher.microphoneEnabled} className={publisher.microphoneEnabled ? 'is-active' : ''} disabled={!publisher.canControl || Boolean(publisher.pendingControl)} type="button" onClick={publisher.toggleMicrophone}>마이크 {publisher.microphoneEnabled ? '켜짐' : '꺼짐'}</button>
            <button aria-pressed={publisher.cameraEnabled} className={publisher.cameraEnabled ? 'is-active' : ''} disabled={!publisher.canControl || Boolean(publisher.pendingControl)} type="button" onClick={publisher.toggleCamera}>카메라 {publisher.cameraEnabled ? '켜짐' : '꺼짐'}</button>
            <button aria-pressed={publisher.screenShareEnabled} className={publisher.screenShareEnabled ? 'is-active' : ''} disabled={!publisher.canControl || Boolean(publisher.pendingControl)} type="button" onClick={publisher.toggleScreenShare}>{publisher.screenShareEnabled ? '화면 공유 중' : '화면 공유'}</button>
            {/*
              카메라 자체를 끄지 않고 합성 화면에서만 내린다. 강사는 계속 자기 카메라를 보면서
              수강생 화면에는 자료만 띄울 수 있다 — 자료에 집중시키고 싶은 구간에서 쓴다.
            */}
            {showCameraPictureInPicture && (
              <button
                aria-pressed={publisher.cameraOverlay.visible}
                className={publisher.cameraOverlay.visible ? 'is-active' : ''}
                disabled={!publisher.canControl}
                type="button"
                onClick={() => publisher.moveCameraOverlay({ visible: !publisher.cameraOverlay.visible })}
              >
                수강생 화면에 카메라 {publisher.cameraOverlay.visible ? '표시' : '숨김'}
              </button>
            )}
          </div>
          {publisher.pendingControl && <span>장치 상태 변경 중...</span>}
        </div>
      </div>
    </div>
  )
}
