import { useEffect, useRef, useState } from 'react'
import HLS from 'hls.js'
import {
  isHLSProvider,
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
} from '@vidstack/react'
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
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
  participantCount: number
  bookmarked: boolean
  onBookmark: () => void
  onRetry: () => void
  onSessionTimeChange: (sessionMs: number) => void
}

type PlaybackState = 'loading' | 'ready' | 'playing' | 'buffering' | 'error'

/**
 * 라이브 엣지에서 몇 세그먼트 뒤에서 재생할지(hls.js 기본 3).
 *
 * 낮출수록 지연이 줄지만 네트워크가 흔들릴 때 버퍼링이 잦아진다. 2가 타협점 —
 * 1은 화면공유처럼 비트레이트가 튀는 구간에서 끊길 여지가 커진다.
 */
const LIVE_SYNC_SEGMENTS = 2

/**
 * vidstack에 duration을 주지 않으면 라이브 되감기가 영구히 잠긴다.
 *
 * vidstack의 seek 허용 조건은 `duration >= liveDVRWindow`인데, 두 값이 이렇게 정해진다:
 *
 *   liveDVRWindow = max(inferredLiveDVRWindow, 60)   inferred는 재생목록 전체 길이 T
 *   seekableEnd   = liveSyncPosition                 = T − (liveSyncDurationCount × 세그먼트)
 *   seekableStart = max(0, seekableEnd − liveDVRWindow) = 0
 *   duration      = seekableEnd − seekableStart      = T − 2
 *
 * 즉 `T − 2 >= T`를 요구한다 — **항상 거짓**이다. 벌어진 폭은 라이브 엣지 오프셋이라
 * 정의상 절대 좁혀지지 않는다. `streamType="live:dvr"`을 줘도 seek이 잠기는 진짜 이유다.
 *
 * duration을 명시하면 `seekableEnd = providedDuration = T`가 되어
 * seekableStart = 0, duration = T = liveDVRWindow → 조건이 성립하고 막대가 강의 전체를 덮는다.
 * (검증: @vidstack/react 1.12 dev 청크의 seekableStart/seekableEnd/canSeek 파생식)
 */
const NO_PROVIDED_DURATION = -1

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
  bookmarked,
  onBookmark,
  onRetry,
  onSessionTimeChange,
}: PlaybackPlayerProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('loading')
  // 라이브 재생목록이 자라는 대로 갱신되는 전체 길이(초). 위 NO_PROVIDED_DURATION 주석 참고.
  const [liveDuration, setLiveDuration] = useState(NO_PROVIDED_DURATION)
  const playerRef = useRef<MediaPlayerInstance>(null)
  const source = playback?.source ?? null
  const isLive = playback ? isLiveStatus(playback.liveSessionStatus) : true

  useEffect(() => setPlaybackState('loading'), [source?.url, reloadToken])
  // 재생 대상이 바뀌면 이전 스트림의 길이를 물려주지 않는다.
  useEffect(() => setLiveDuration(NO_PROVIDED_DURATION), [source?.url, reloadToken])

  // 이미 반영한 seek 요청의 sequence. 같은 요청을 두 번 적용하지 않기 위한 것이다.
  const appliedSeekSequence = useRef(-1)
  useEffect(() => {
    if (!source || !seekRequest || !playerRef.current) return
    // `source`는 재생 metadata 폴링마다 **새 객체**로 온다(usePlayback refetchInterval). 이 effect가
    // source 동일성으로 재실행되면 지난 seek 요청을 폴링 주기마다 다시 적용해, 재생 중인 영상이 계속
    // 그 위치로 되돌아간다. sequence로 "새 요청일 때만" 적용한다 — sequence가 있는 이유가 이것이다.
    // (source가 아직 없어 못 옮긴 요청은 적용 표시를 남기지 않아, 준비되면 그때 한 번 반영된다.)
    if (appliedSeekSequence.current === seekRequest.sequence) return
    appliedSeekSequence.current = seekRequest.sequence
    playerRef.current.currentTime = toMediaTimeSeconds(seekRequest.sessionMs, source.availableFromMs)
  }, [source, seekRequest])

  const handleProviderChange = (provider: MediaProviderAdapter | null) => {
    if (!isHLSProvider(provider)) return
    provider.library = HLS
    provider.config = {
      // hls.js 기본값은 라이브 엣지에서 3세그먼트 뒤부터 재생한다(안전 버퍼). 세그먼트 단위라
      // 세그먼트가 2초면 그것만으로 6초가 붙는다. 강의는 단방향 방송이라 버퍼를 조금 줄여도
      // 체감 손해가 적다 — 실측 총 지연 ~10초 중 이 값이 가장 큰 몫이었다.
      liveSyncDurationCount: LIVE_SYNC_SEGMENTS,
      // 기본값 1은 "따라잡기 금지"라, 한 번 버퍼링으로 밀리면 그 지연이 영구히 남는다.
      // 5% 빠르게 재생해 조용히 엣지로 복귀시킨다(체감되지 않는 수준).
      maxLiveSyncPlaybackRate: 1.05,
    }
    // 다시보기(ENDLIST 있음)는 vidstack이 스스로 길이를 알아 손댈 필요가 없다.
    if (!isLive) return
    provider.onInstance((instance) => {
      instance.on(HLS.Events.LEVEL_UPDATED, (_event, data) => {
        const total = data.details.totalduration
        if (total > 0) setLiveDuration(total)
      })
    })
  }

  const retryPlayback = () => {
    setPlaybackState('loading')
    onRetry()
  }

  const statusState: PlaybackState = errorMessage ? 'error' : loading ? 'loading' : playbackState

  // 랜드마크 이름은 라이브/다시보기에 걸쳐 고정한다 — 세션이 끝나 라이브가 다시보기로 바뀌는
  // 중에 이름까지 변하면 보조기술 사용자가 같은 영역을 다시 찾아야 한다. 상태는 헤더의
  // 'LIVE'/'다시보기' 텍스트가 전달한다.
  return (
    <div aria-label="강의 영상" className="video-stage student-live-stage" role="region">
      {source
        ? (
          // key는 실제 재생 대상이 바뀔 때만 변한다. 폴링 갱신마다 리마운트하면 재생이 끊긴다.
          <MediaPlayer
            key={`${playback?.sessionId}-${source.url}-${reloadToken}`}
            ref={playerRef}
            autoPlay
            className="student-live-player"
            duration={liveDuration}
            playsInline
            src={{ src: source.url, type: 'application/vnd.apple.mpegurl' }}
            streamType={isLive ? 'live:dvr' : 'on-demand'}
            title={lessonTitle}
            onCanPlay={() => setPlaybackState('ready')}
            onError={() => setPlaybackState('error')}
            onPlaying={() => setPlaybackState('playing')}
            onProviderChange={handleProviderChange}
            onTimeUpdate={(detail) => onSessionTimeChange(toSessionMs(detail.currentTime, source.availableFromMs))}
            onWaiting={() => setPlaybackState('buffering')}
          >
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>
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

      {source && playbackState === 'error' && (
        <div className="student-live-empty student-live-empty--error" role="alert">
          <strong>HLS 영상을 재생하지 못했습니다.</strong>
          <p>현재 세션의 재생 주소를 다시 받은 뒤 연결을 재시도해 주세요.</p>
          <button className="button button--soft button--small" type="button" onClick={retryPlayback}>재생 주소 다시 받기</button>
        </div>
      )}

      <header className="student-live-status" aria-label="재생 정보">
        <div>
          {/* 세션이 끝나면 LIVE 표시를 내린다. 플레이어 안의 LIVE 버튼(엣지 복귀)은 vidstack이 담당한다. */}
          {isLive && <span className="live-dot" aria-hidden="true" />}
          <strong>{isLive ? 'LIVE' : '다시보기'}</strong>
          <span>{lessonTitle}</span>
        </div>
        <div>
          <StatusBadge tone={statusState === 'error' ? 'danger' : statusState === 'buffering' || statusState === 'loading' ? 'warning' : 'success'}>
            {playbackLabel(statusState)}
          </StatusBadge>
          <span>{participantCount}명 참여 중</span>
          <button className={bookmarked ? 'is-active' : ''} type="button" onClick={onBookmark}>
            {bookmarked ? '★ 북마크됨' : '☆ 북마크'}
          </button>
        </div>
      </header>
    </div>
  )
}
