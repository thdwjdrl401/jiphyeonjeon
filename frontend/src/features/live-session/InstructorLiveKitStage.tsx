import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'
import CameraOverlayControl from './CameraOverlayControl'
import InstructorAnnotationLayer from './InstructorAnnotationLayer'
import InstructorLocalTrackVideo from './InstructorLocalTrackVideo'
import MediaToggleIcon from './MediaToggleIcon'
import MediaFailureNotice from './MediaFailureNotice'
import { useAnnotationHighlightCapture } from './useAnnotationHighlightCapture'
import { useInstructorLiveKit, type InstructorLiveKitConnectionState } from './useInstructorLiveKit'

interface InstructorLiveKitStageProps {
  sessionId: string
  lessonTitle: string
  participantCount: number
  onRequestEnd: () => void
  /**
   * 예전에 페이지 위쪽 네비바가 담당하던 "브랜드·돌아가기" 링크(LessonLayout 참고). 강의실은
   * 그 네비바를 없애고 이 강의 정보 헤더가 대신 담는다 — 없으면 자리를 비워 둔다.
   */
  backLink?: ReactNode
  /**
   * "강의 종료" 버튼 바로 아래 뜨는 확인 드롭다운(실제 종료 여부·뮤테이션은 부모가 쥔다). 버튼과
   * 함께 상대 위치 컨테이너에 담아, 미디어 영역 우측 상단 그 자리에서 바로 펼쳐지게 한다.
   */
  endConfirm?: ReactNode
  /** 드롭다운이 떠 있는 동안 그 바깥을 누르거나 Escape를 누르면 호출된다. `endConfirm`이 있을 때만 듣는다. */
  onDismissEndConfirm?: () => void
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

/**
 * 마지막으로 본 판서 표시 상태. <b>정본이 아니다</b> — 서버 응답이 오기 전까지 화면을 채우는
 * 임시값이다(ADR-0056).
 *
 * <p>`sessionStorage`를 쓴다. 탭을 닫으면 사라지는 것이 맞다 — 다른 기기·다른 창에서는 서버 값이
 * 정본이고, 여기 남은 값이 그것을 이기면 안 된다.
 */
const ANNOTATING_CACHE_PREFIX = 'liveclass.annotating.'

function readCachedAnnotating(sessionId: string): boolean {
  try {
    return sessionStorage.getItem(ANNOTATING_CACHE_PREFIX + sessionId) === 'true'
  } catch {
    // 프라이빗 모드 등에서 접근이 막힐 수 있다. 캐시가 없는 것과 같게 다룬다.
    return false
  }
}

function writeCachedAnnotating(sessionId: string, visible: boolean): void {
  try {
    sessionStorage.setItem(ANNOTATING_CACHE_PREFIX + sessionId, String(visible))
  } catch {
    // 저장하지 못해도 기능에는 영향이 없다 — 다음 새로고침에서 깜빡일 뿐이다.
  }
}

export default function InstructorLiveKitStage({ sessionId, lessonTitle, participantCount, onRequestEnd, backLink, endConfirm, onDismissEndConfirm }: InstructorLiveKitStageProps) {
  const publisher = useInstructorLiveKit()
  /*
   * 종료 확인 드롭다운 바깥을 누르거나 Escape를 누르면 닫는다 — 정보 안내 팝오버
   * (PersonalAiQuestionPanel) · 알림 스위치(BrowserNotificationToggle)와 같은 요령이다.
   * `endConfirm`이 있을 때만 듣는다(닫혀 있으면 바깥 클릭까지 가로챌 이유가 없다).
   */
  const endMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!endConfirm || !onDismissEndConfirm) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!endMenuRef.current?.contains(event.target as Node)) onDismissEndConfirm()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismissEndConfirm()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [endConfirm, onDismissEndConfirm])
  /**
   * 판서를 켤지. <b>정본은 서버이고 이것은 그 사본이다</b>(ADR-0056).
   *
   * <p>첫 프레임은 로컬 캐시로 채운다 — 복원 응답이 오기까지 몇백 ms가 걸리는데(실측 최대 983kB)
   * 그동안 "꺼짐 → 켜짐"으로 깜빡이면 안 된다. 서버 값이 도착하면 <b>무조건 그것이 이긴다.</b>
   */
  const [annotating, setAnnotating] = useState(() => readCachedAnnotating(sessionId))

  /**
   * 서버가 답하면 그 값으로 맞춘다. 이것이 "로컬은 캐시"라는 규칙이 실제로 지켜지는 자리다 —
   * 여기서 비교하지 않으면 로컬이 두 번째 정본이 되어 서로 갈린다(그게 지금까지의 버그였다).
   *
   * <p>한 번만 본다. 그 뒤 강사가 켜고 끄는 것은 강사의 선택이므로 되돌리지 않는다.
   */
  const restoredVisible = publisher.restoredAnnotationVisible
  const restoredAppliedRef = useRef(false)
  /**
   * 강사가 이미 켜거나 껐는가.
   *
   * <p><b>복원이 사용자의 나중 조작을 덮으면 안 된다.</b> 복원 응답은 몇백 ms 뒤에 오는데, 그
   * 사이에 강사가 판서를 켰다면 그것이 최신 의사다. 그때 서버 값(그 조작 이전의 상태)으로 되돌리면
   * <b>켠 판서가 저절로 꺼진다</b> — 실제로 그렇게 동작했다.
   *
   * <p>"서버가 이긴다"는 규칙은 <b>사용자가 아직 말하지 않았을 때</b>의 규칙이다.
   */
  const userChangedRef = useRef(false)
  useEffect(() => {
    if (restoredAppliedRef.current || userChangedRef.current || restoredVisible === null) return
    restoredAppliedRef.current = true
    setAnnotating(restoredVisible)
  }, [restoredVisible])

  /** 켜고 끌 때마다 서버에 남기고 로컬 캐시도 갱신한다. */
  const changeAnnotating = useCallback((next: boolean) => {
    userChangedRef.current = true
    setAnnotating(next)
    writeCachedAnnotating(sessionId, next)
    publisher.saveAnnotationVisible(next)
  }, [publisher, sessionId])
  /**
   * 판서 속성 패널(색·굵기·투명도)은 <b>접힌 상태로 시작</b>한다. 자료 위에 그리는 화면에서 좌우
   * 패널이 시야를 가리고, 색·굵기는 매 획마다 바꾸는 것이 아니다. 필요할 때만 펼친다.
   */
  const [propertyPanel, setPropertyPanel] = useState(false)
  /**
   * 화이트보드. 화면공유 없이 판서만 할 때 프레임 전체를 흰 판으로 덮는다 — 카메라만 켠 상태에서
   * 얼굴 위에 그리는 것보다 판을 깔고 쓰는 편이 낫다.
   */
  /**
   * 화이트보드. <b>별도 상태가 아니라 문서의 사본이다</b>(ADR-0056).
   *
   * <p>화이트보드는 이미 문서 안의 요소(`liveclass-whiteboard`)라 서버에 저장되고 복원된다. 예전에는
   * 버튼이 그것을 읽지 않고 따로 `false`로 시작해서, 새로고침하면 <b>화면에는 판이 있는데 버튼은
   * "꺼짐"</b>이 됐다. 레이어가 실제 문서 상태를 알려 주면 그 어긋남이 정의상 사라진다.
   */
  const [whiteboard, setWhiteboard] = useState(false)

  /**
   * 전체화면. 판서를 하려면 합성 캔버스가 커야 하는데, 기본 배치에서는 사이드바에 눌려 작다.
   *
   * <p>대상은 <b>스테이지 전체</b>다. 미리보기만 전체화면으로 만들면 하단 컨트롤(판서 토글·카메라 등)이
   * 화면 밖으로 나가 강사가 아무것도 조작할 수 없다.
   *
   * <p>전체화면이 되어도 판서 좌표는 흔들리지 않는다 — 에디터는 고정 1920x1080 무대에 살고 배율만
   * 바뀌므로, 커진 화면에서 그린 획도 같은 프레임 좌표로 기록된다.
   */
  const stageRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => { setFullscreen(document.fullscreenElement === stageRef.current) }
    document.addEventListener('fullscreenchange', onChange)
    return () => { document.removeEventListener('fullscreenchange', onChange) }
  }, [])

  const toggleFullscreen = useCallback(() => {
    // 실패해도 강의는 계속되어야 한다. 브라우저가 거부하는 경우(권한·정책)가 있어 조용히 흘린다.
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    void stageRef.current?.requestFullscreen().catch((error: unknown) => {
      console.warn('전체화면으로 전환하지 못했습니다', error)
    })
  }, [])
  const screenShareTrack = publisher.screenShareEnabled ? publisher.screenShareTrack : undefined
  const cameraTrack = publisher.cameraEnabled ? publisher.cameraTrack : undefined
  const mainTrack = screenShareTrack ?? cameraTrack

  /**
   * 합성 화면의 video element. 강조 캡처가 이 프레임을 잘라 쓴다(ADR-0074).
   *
   * <p>화면공유가 있으면 그쪽, 없으면 카메라다 — {@code mainTrack}이 이미 그 규칙이라 따로 고르지
   * 않는다. 강조 대상은 대개 슬라이드이고, 카메라를 잡으면 강사 얼굴이 근거로 색인된다.
   */
  const mainVideoRef = useRef<HTMLVideoElement | null>(null)
  const highlightCapture = useAnnotationHighlightCapture({
    sessionId,
    resolveVideo: () => mainVideoRef.current,
  })
  /**
   * 강조 저장 확인을 <b>스스로 닫는다</b> — 바깥을 누르거나 Esc, 그리고 12초가 지나면.
   *
   * <p>예전에는 강사가 둘 중 하나를 누를 때까지 하단 중앙에 남아 있었다. 그런데 강사는 강조를 그린
   * 직후에 <b>계속 그리고 있고</b>, 그 자리가 정확히 판서하는 자리다 — 대답을 요구하는 상자가 붓
   * 아래에 눌어붙어 있었다.
   *
   * <p><b>닫힘은 "아니요"다.</b> 이 확인이 잘못된 근거를 막는 유일한 게이트이므로(ADR-0074),
   * 대답하지 않은 것을 승낙으로 읽으면 안 된다.
   */
  const highlightPrompt = highlightCapture.prompt
  useEffect(() => {
    if (!highlightPrompt) return undefined
    const close = () => highlightPrompt.dismiss()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target?.closest('.annotation-highlight-prompt')) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    // 판서를 이어 가는 손을 막지 않을 만큼 짧게, 읽고 누를 수는 있을 만큼 길게.
    const timer = window.setTimeout(close, 12_000)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [highlightPrompt])

  const showCameraPictureInPicture = Boolean(screenShareTrack && cameraTrack)
  const canRetry = publisher.connectionState === 'error' || publisher.connectionState === 'disconnected'

  return (
    <div
      ref={stageRef}
      className={`video-stage video-stage--instructor${fullscreen ? ' is-fullscreen' : ''}`}
      tabIndex={0}
    >
      <div className="video-stage__glow" />
      <header className="video-status-overlay" aria-label="라이브 강의 정보">
        <div className="video-status-overlay__identity"><span className="live-dot" /><strong>LIVE</strong><h1>{lessonTitle}</h1>{backLink}</div>
        <div className="video-status-overlay__status">
          <StatusBadge tone="warning">강사 운영 모드</StatusBadge>
          {connectionBadge(publisher.connectionState)}
          <span>{participantCount}명 참여 중</span>
          <div className="instructor-end-menu" ref={endMenuRef}>
            <button className="button button--soft button--small" type="button" onClick={onRequestEnd}>강의 종료</button>
            {endConfirm}
          </div>
        </div>
      </header>
      <div className="instructor-media-preview">
        {/*
          미리보기 영역이 아니라 <b>합성 캔버스(16:9)</b>를 그린다. 미리보기 영역은 창 크기와 사이드바에
          따라 아무 비율이나 되는데, 수강생에게 나가는 프레임은 언제나 16:9다. 영역 전체를 무대로 쓰면
          같은 0~1 좌표가 서로 다른 자리를 가리켜 카메라 배치가 어긋나고, 강사는 실제로 나가지 않는
          여백까지 화면으로 착각한다. 캔버스를 따로 잡아 그 안에만 그리면 강사가 보는 사각형이 곧
          수강생이 받는 프레임이 된다.
        */}
        <div className="instructor-media-canvas">
          {/*
            항상 contain으로 그린다. cover는 캔버스 비율에 맞춰 영상을 잘라내는데, Egress 템플릿은
            자르지 않으므로 강사에게만 안 보이는 영역이 수강생에게는 보이게 된다. 잘리지 않는 대신
            레터박스가 생기지만, 실제로 나가는 화면과 같은 것을 보는 편이 낫다.
          */}
          {mainTrack
            ? (
              <InstructorLocalTrackVideo
                fit="contain"
                mirrored={!screenShareTrack && publisher.cameraOverlay.mirrored}
                label={screenShareTrack ? '공유 화면 미리보기' : '카메라 미리보기'}
                track={mainTrack}
                elementRef={mainVideoRef}
              />
            )
            : <div className="instructor-media-empty"><span aria-hidden="true">◉</span><strong>{emptyPreviewMessage(publisher.connectionState, publisher.cameraEnabled)}</strong></div>}
          {/*
            화면공유 위의 카메라는 단순 미리보기가 아니라 합성 화면의 편집기다. 여기서 옮긴 자리가
            그대로 수강생 녹화가 된다 — 미리보기와 Egress 템플릿이 같은 값(0~1 비율)을 읽는다.

            카메라는 거울처럼 뒤집어 그린다. 강사가 자기 얼굴을 거울로 보는 것이 이 서비스의 기준이고,
            Egress 템플릿도 카메라 트랙만 같은 방향으로 뒤집는다(egress-stage.css). 화면공유는 글자가
            읽혀야 하므로 절대 뒤집지 않는다 — 그래서 뒤집기는 프레임 전체가 아니라 카메라에만 건다.

            다만 뒤집을지는 배치(cameraOverlay.mirrored)가 정한다. 파일 송출은 거울상이 아니라서
            뒤집으면 화면 속 글자가 반전된 채 녹화에 남는다(ADR-0100).
          */}
          {showCameraPictureInPicture && cameraTrack && (
            <CameraOverlayControl
              overlay={publisher.cameraOverlay}
              onChange={publisher.moveCameraOverlay}
              disabled={!publisher.canControl}
            >
              <InstructorLocalTrackVideo mirrored={publisher.cameraOverlay.mirrored} label="카메라 미리보기" track={cameraTrack} />
            </CameraOverlayControl>
          )}
          {/*
            판서는 합성 캔버스 안에 둔다 — 이 사각형이 곧 수강생이 받는 프레임이므로, 강사가 여기에
            그린 좌표가 그대로 Egress 렌더 좌표가 된다. 미리보기 영역 전체에 두면 실제로 나가지 않는
            여백에도 그릴 수 있게 되어 강사만 보이는 판서가 생긴다.
          */}
          <InstructorAnnotationLayer
            active={annotating}
            sessionId={sessionId}
            audienceRevision={publisher.annotationAudienceRevision}
            showPropertyPanel={propertyPanel}
            whiteboard={whiteboard}
            onLaser={publisher.publishLaser}
            onPublish={publisher.publishAnnotation}
            onWhiteboardPresence={setWhiteboard}
            onSaveSnapshot={publisher.saveAnnotationSnapshot}
            onPublishState={publisher.publishAnnotationState}
            restoredElements={publisher.restoredAnnotation?.elements ?? null}
            restoredFiles={publisher.restoredAnnotation?.files ?? null}
            onHighlightSettled={highlightCapture.onHighlightSettled}
          />

          {/*
            강조 캡처 확인(ADR-0074). <b>묻고 나서 자른다</b> — 캡처는 export·인코딩을 연달아 돌려
            강사 화면이 잠깐 멎으므로, 강사가 누른 순간에만 그 멈춤이 생기게 한다.

            그리고 AI가 이 텍스트를 검증 없이 신뢰하기로 했으므로, 이 확인이 잘못된 근거를 막는
            유일한 게이트다.
          */}
          {highlightCapture.prompt && (
            <div className="annotation-highlight-prompt" role="dialog" aria-label="AI 답변 자료 저장 확인">
              <div className="annotation-highlight-prompt__text">
                <strong>{highlightCapture.prompt.message}</strong>
                <small>{highlightCapture.prompt.detail}</small>
              </div>
              {/*
                버튼 글자에 <b>대상</b>을 넣는다. 예전에는 `남기기`·`안 남김`이라 무엇을 남기는지가
                동사에 없었다 — 강사는 판서를 지운다는 뜻으로도 읽을 수 있었다.
              */}
              <div className="annotation-highlight-prompt__actions">
                <button type="button" className="button button--soft"
                  onClick={highlightCapture.prompt.dismiss}>아니요</button>
                <button type="button" className="button button--primary"
                  onClick={highlightCapture.prompt.confirm}>저장</button>
              </div>
            </div>
          )}
          {highlightCapture.status === 'capturing' && (
            <p className="annotation-highlight-status" role="status">강조를 저장하는 중…</p>
          )}
          {highlightCapture.notice && highlightCapture.status !== 'capturing' && (
            <p className="annotation-highlight-status" role="status"
              onClick={highlightCapture.dismissNotice}>{highlightCapture.notice}</p>
          )}
        </div>
      </div>


      {publisher.errorMessage && (
        <div className="instructor-media-error" role="alert">
          <span>{publisher.errorMessage}</span>
          {canRetry && <button className="button button--soft button--small" type="button" onClick={publisher.retry}>다시 연결</button>}
        </div>
      )}

      {publisher.notice && <div className="instructor-media-notice" role="status">{publisher.notice}</div>}

      {/*
        장치 문제는 강의 중에도 뜬다 — "이번만 허용"이 끝나면 브라우저가 마이크를 끊는다.
        그때 닫을 수 있어야 화면을 가리지 않는다(연결 오류와 달리 강의는 계속되고 있다).
      */}
      {publisher.mediaFailure && (
        <MediaFailureNotice
          className="media-failure--overlay"
          failure={publisher.mediaFailure}
          pending={Boolean(publisher.pendingControl)}
          onDismiss={publisher.dismissMediaFailure}
          onRetry={publisher.retryMedia}
        />
      )}

      <div className="video-controls-overlay" aria-label="강사 송출 컨트롤">
        <div className="control-row">
          {/*
            두 묶음이다 — <b>내보내는 것</b>(마이크·카메라·화면공유)과 <b>판서</b>. 예전에는 일곱 개가
            같은 굵기·같은 어미로 한 줄에 서서 서로 구분되지 않았고, 넷이 "켜짐/꺼짐"으로 끝나 정작
            중요한 마이크 상태가 묻혔다.

            상태 규칙은 둘뿐이다.
              채움 = 켜짐 (예외 없음)
              사선 = 꺼짐 (아이콘이 있는 마이크·카메라만)

            "켜짐/꺼짐" 글자를 뺀 것은 폭 때문만이 아니다. 대가가 다르기 때문이다 — 마이크가 꺼진 줄
            모르고 10분을 말하면 그 10분이 통째로 사라지지만(자막도 녹화도 없다), 판서가 켜졌는지는
            한 획 그어 보면 즉시 안다. 글자는 앞의 것에만 필요하고, 그것도 아이콘의 사선이 더 잘 한다.
          */}
          <div className="control-row__group">
            <button
              aria-pressed={publisher.microphoneEnabled}
              className={publisher.microphoneEnabled ? 'is-active' : ''}
              disabled={!publisher.canControl || Boolean(publisher.pendingControl)}
              title={publisher.microphoneEnabled ? '마이크 끄기' : '마이크 켜기'}
              type="button"
              onClick={publisher.toggleMicrophone}
            >
              <MediaToggleIcon kind="microphone" off={!publisher.microphoneEnabled} />
              마이크
            </button>
            <button
              aria-pressed={publisher.cameraEnabled}
              className={publisher.cameraEnabled ? 'is-active' : ''}
              disabled={!publisher.canControl || Boolean(publisher.pendingControl)}
              title={publisher.cameraEnabled ? '카메라 끄기' : '카메라 켜기'}
              type="button"
              onClick={publisher.toggleCamera}
            >
              <MediaToggleIcon kind="camera" off={!publisher.cameraEnabled} />
              카메라
            </button>
            <button
              aria-pressed={publisher.screenShareEnabled}
              className={publisher.screenShareEnabled ? 'is-active' : ''}
              disabled={!publisher.canControl || Boolean(publisher.pendingControl)}
              type="button"
              onClick={publisher.toggleScreenShare}
            >
              화면 공유
            </button>
          </div>
          {/*
            판서를 켜면 캔버스가 포인터를 받는다. 그래서 카메라 배치 드래그와 동시에 쓸 수 없고,
            토글로 둔다 — 켠 상태를 유지하면 강사가 왜 카메라를 못 옮기는지 알기 어렵다.
          */}
          <div className="control-row__group">
            <button
              aria-pressed={annotating}
              className={annotating ? 'is-active' : ''}
              disabled={!publisher.canControl}
              type="button"
              onClick={() => changeAnnotating(!annotating)}
            >
              판서
            </button>
            {/*
              화이트보드. 배경색이 아니라 맨 뒤에 깔리는 잠긴 요소라, 켜고 끄는 것이 그대로
              수강생 화면·녹화에 반영된다.
            */}
            {annotating && (
              <button
                aria-pressed={whiteboard}
                className={whiteboard ? 'is-active' : ''}
                type="button"
                onClick={() => setWhiteboard((current) => !current)}
              >
                화이트보드
              </button>
            )}
            {/*
              색·굵기·투명도 패널(Excalidraw zen 모드 해제).

              <b>이름이 "도구 모음"이 아닌 이유.</b> 위 가운데 툴 섬(펜·지우개·도형)은 zen 모드에서도
              그대로 떠 있다 — 실제 화면에서 확인했다. 그러니 이 버튼이 여는 것은 도구를 고르는 곳이
              아니라 <b>왼쪽 색·굵기 패널</b>이고, 강사가 이걸 누르는 이유도 "빨간색으로 바꾸려고"다.

              기본은 접혀 있다 — 자료 위에 그리는 화면에서 좌우 패널이 시야를 가리고, 색·굵기는
              매 획마다 바꾸는 것이 아니다.
            */}
            {annotating && (
              <button
                aria-pressed={propertyPanel}
                className={propertyPanel ? 'is-active' : ''}
                type="button"
                onClick={() => setPropertyPanel((current) => !current)}
              >
                서식
              </button>
            )}
          </div>
          <div className="control-row__trailing">
            {publisher.pendingControl && <span>장치 상태 변경 중...</span>}
            {/*
              영상 플레이어의 그 자리 그대로 — 컨트롤 줄 오른쪽 끝에 아이콘만. 판서를 하려면 캔버스가
              커야 하는데 사이드바에 눌린 기본 배치에서는 글씨를 쓸 공간이 없다.
            */}
            <button
              aria-label={fullscreen ? '전체화면 해제' : '전체화면'}
              aria-pressed={fullscreen}
              className={`video-controls-overlay__icon${fullscreen ? ' is-active' : ''}`}
              title={fullscreen ? '전체화면 해제' : '전체화면'}
              type="button"
              onClick={toggleFullscreen}
            >
              <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
                {fullscreen
                  ? <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4" />
                  : <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />}
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
