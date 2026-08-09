import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import HlsMediaPlayer, {
  type HlsMediaControlsHandle,
  type HlsMediaSeekRequest,
  type HlsMediaState,
} from '@/features/media/HlsMediaPlayer'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'
import { isLiveStatus } from './liveSessionService'
import type { PlaybackView } from './liveSessionService.interface'

export interface PlaybackSeekRequest {
  sessionMs: number
  sequence: number
}

interface PlaybackPlayerProps {
  playback: PlaybackView | null
  /** 명시적 재시도에만 증가한다. 폴링 갱신으로 바뀌면 플레이어가 리마운트되어 재생이 끊긴다. */
  reloadToken: number
  loading: boolean
  errorMessage: string | null
  seekRequest: PlaybackSeekRequest | null
  lessonTitle: string
  /** 지금 보고 있는 사람 수. 다시보기에는 그런 것이 없으므로 주지 않으면 표시하지 않는다. */
  participantCount?: number
  onRetry: () => void
  onSessionTimeChange: (sessionMs: number) => void
  /**
   * 플레이어 루트가 붙거나 떨어질 때 알린다. 재생바 위에 "많이 다시 본 구간" 곡선을 얹으려면
   * vidstack이 만든 슬라이더 노드가 필요한데, 그 노드는 이 안에만 있다.
   */
  onRootChange?: (root: HTMLElement | null) => void
  /**
   * 이 브라우저가 마지막 세그먼트까지 다 본 뒤 영상 위에 얹을 안내. 라이브에서 학생을 다시보기로
   * 보내는 자리다(ADR-0005 §3). 세션 상태가 아니라 <b>재생 완료</b>에 걸린다.
   */
  endedNotice?: ReactNode
  /**
   * 예전에 페이지 위쪽 네비바가 담당하던 "브랜드·돌아가기" 링크(LessonLayout 참고). 강의실은
   * 그 네비바를 없애고 이 재생 정보 헤더가 대신 담는다 — 없으면 자리를 비워 둔다.
   */
  backLink?: ReactNode
  /**
   * 화면마다 다른, 재생 상태 배지 옆에 덧붙일 것들(다시보기의 검수·게시 배지, 진행률, 강의 상세
   * 링크 등). 이 컴포넌트가 그 도메인 개념을 알 필요는 없으므로 내용은 호출부가 만들어 온다.
   */
  headerExtra?: ReactNode
}

type PlaybackState = HlsMediaState

/**
 * 미디어 시각 ↔ 세션 시각 변환.
 *
 * 기준은 재생 중인 source의 `availableFromMs` — 미디어 시각 0이 가리키는 세션 시각이다.
 * source가 담는 구간의 시작이 세션 시작과 다를 수 있고, 그만큼 자막이 통째로 어긋난다.
 */
export function toSessionMs(mediaTimeSeconds: number, availableFromMs: number | null) {
  return Math.max(0, Math.round(mediaTimeSeconds * 1000 + (availableFromMs ?? 0)))
}

export function toMediaTimeSeconds(sessionMs: number, availableFromMs: number | null) {
  return Math.max(0, (sessionMs - (availableFromMs ?? 0)) / 1000)
}

function playbackLabel(state: PlaybackState) {
  if (state === 'playing') return '재생 중'
  if (state === 'ready') return '재생 준비됨'
  if (state === 'buffering') return '버퍼링 중'
  if (state === 'error') return '재생 오류'
  return '스트림 연결 중'
}

export default function PlaybackPlayer({
  playback,
  reloadToken,
  loading,
  errorMessage,
  seekRequest,
  lessonTitle,
  participantCount,
  onRetry,
  onSessionTimeChange,
  onRootChange,
  backLink,
  endedNotice,
  headerExtra,
}: PlaybackPlayerProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('loading')
  // 재생 정보 헤더를 재생바(vidstack 컨트롤)와 같은 타이밍으로 띄우고 지운다 — 컨트롤이 idle로
  // 숨을 때 헤더도 같이 숨어야 "동기화"고, 따로 놀면 한쪽만 남아 어색해진다.
  const [controlsVisible, setControlsVisible] = useState(true)
  const controlsHandleRef = useRef<HlsMediaControlsHandle | null>(null)
  const source = playback?.source ?? null
  const isLive = playback ? isLiveStatus(playback.liveSessionStatus) : true
  const mediaSeekRequest = useMemo<HlsMediaSeekRequest | null>(() => {
    if (!source || !seekRequest) return null
    return {
      mediaTimeSeconds: toMediaTimeSeconds(seekRequest.sessionMs, source.availableFromMs),
      sequence: seekRequest.sequence,
    }
  }, [seekRequest, source])

  const retryPlayback = () => {
    setPlaybackState('loading')
    onRetry()
  }

  /*
   * 헤더는 vidstack 컨트롤 밖(형제 요소)에 떠 있어 vidstack이 감시하는 pointermove가 헤더 위에서는
   * 잡히지 않는다 — 그대로 두면 헤더 위에 마우스를 올려 둔 채 가만히 있어도 재생바만 혼자 사라진다.
   * 헤더에서 마우스가 움직이면 같은 idle 타이머를 직접 되돌려 둘이 같이 떠 있게 만든다.
   */
  const keepControlsAlive = useCallback(() => {
    controlsHandleRef.current?.show()
    controlsHandleRef.current?.hide()
  }, [])

  const statusState: PlaybackState = errorMessage ? 'error' : loading ? 'loading' : playbackState

  // 랜드마크 이름은 라이브/다시보기에 걸쳐 고정한다 — 세션이 끝나 라이브가 다시보기로 바뀌는
  // 중에 이름까지 변하면 보조기술 사용자가 같은 영역을 다시 찾아야 한다. 상태는 헤더의
  // 'LIVE'/'다시보기' 텍스트가 전달한다.
  return (
    <div aria-label="강의 영상" className="video-stage student-live-stage" ref={onRootChange} role="region">
      {source
        ? (
          // key는 실제 재생 대상이 바뀔 때만 변한다. 폴링 갱신마다 리마운트하면 재생이 끊긴다.
          <HlsMediaPlayer
            sourceUrl={source.url}
            title={lessonTitle}
            streamType={isLive ? 'live:dvr' : 'on-demand'}
            durationMs={playback?.durationMs ?? null}
            reloadToken={reloadToken}
            seekRequest={mediaSeekRequest}
            autoPlay
            onControlsHandle={(handle) => { controlsHandleRef.current = handle }}
            onControlsVisibleChange={setControlsVisible}
            onStateChange={setPlaybackState}
            onTimeChange={(mediaTimeMs) => onSessionTimeChange(
              toSessionMs(mediaTimeMs / 1000, source.availableFromMs),
            )}
          />
        )
        : (
          // source가 null인 건 오류가 아니라 대기다 — 녹화 시작 직후 첫 세그먼트가 아직 안 올라온 것.
          // 상위에서 재폴링하므로 사용자는 기다리면 된다.
          <div className={`student-live-empty${errorMessage ? ' student-live-empty--error' : ''}`} role={errorMessage ? 'alert' : 'status'}>
            <strong>
              {errorMessage
                ? '라이브 영상을 불러오지 못했습니다.'
                : playback
                  ? '영상이 곧 시작됩니다.'
                  : loading
                    ? '재생 정보를 불러오고 있습니다.'
                    : '라이브 영상 연결을 준비하고 있습니다.'}
            </strong>
            <p>
              {errorMessage ?? (playback
                ? '녹화가 시작돼 첫 구간이 준비되는 중입니다. 곧 자동으로 재생됩니다.'
                : loading
                  ? '현재 강의의 재생 주소를 확인하고 있습니다.'
                  : '녹화 안내를 확인하면 라이브 영상에 연결합니다.')}
            </p>
            {errorMessage && <button className="button button--soft button--small" type="button" onClick={retryPlayback}>다시 시도</button>}
          </div>
        )}

      {/*
        마지막 세그먼트까지 소비했을 때만 뜬다(ADR-0005 §3) — 세션이 ENDED가 된 시각이 아니다.
        플레이어는 그대로 둔다: 언마운트하면 되감아 다시 볼 수도 없다.
      */}
      {source && playbackState === 'ended' && endedNotice}

      {source && playbackState === 'error' && (
        <div className="student-live-empty student-live-empty--error" role="alert">
          <strong>HLS 영상을 재생하지 못했습니다.</strong>
          <p>현재 세션의 재생 주소를 다시 받은 뒤 연결을 재시도해 주세요.</p>
          <button className="button button--soft button--small" type="button" onClick={retryPlayback}>재생 주소 다시 받기</button>
        </div>
      )}

      <header
        aria-label="재생 정보"
        className={`student-live-status${controlsVisible ? ' is-visible' : ''}`}
        onFocus={keepControlsAlive}
        onPointerMove={keepControlsAlive}
      >
        <div>
          {backLink}
          {/* 세션이 끝나면 LIVE 표시를 내린다. 플레이어 안의 LIVE 버튼(엣지 복귀)은 vidstack이 담당한다. */}
          {isLive && <span className="live-dot" aria-hidden="true" />}
          <strong>{isLive ? 'LIVE' : '다시보기'}</strong>
          <span>{lessonTitle}</span>
        </div>
        <div>
          <StatusBadge tone={statusState === 'error' ? 'danger' : statusState === 'buffering' || statusState === 'loading' ? 'warning' : 'success'}>
            {playbackLabel(statusState)}
          </StatusBadge>
          {participantCount !== undefined && <span>{participantCount}명 참여 중</span>}
          {headerExtra}
        </div>
      </header>
    </div>
  )
}
