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

export interface StudentLiveSeekRequest {
  sessionMs: number
  sequence: number
}

interface StudentLivePlayerProps {
  playback: PlaybackView | null
  /** 명시적 재시도에만 증가한다. 폴링 갱신으로 바뀌면 플레이어가 리마운트되어 재생이 끊긴다. */
  reloadToken: number
  loading: boolean
  errorMessage: string | null
  seekRequest: StudentLiveSeekRequest | null
  lessonTitle: string
  participantCount: number
  bookmarked: boolean
  onBookmark: () => void
  onRetry: () => void
  onSessionTimeChange: (sessionMs: number) => void
}

type PlaybackState = 'loading' | 'ready' | 'playing' | 'buffering' | 'error'

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

export default function StudentLivePlayer({
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
}: StudentLivePlayerProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('loading')
  const playerRef = useRef<MediaPlayerInstance>(null)
  const source = playback?.source ?? null
  const isLive = playback ? isLiveStatus(playback.liveSessionStatus) : true

  useEffect(() => setPlaybackState('loading'), [source?.url, reloadToken])

  useEffect(() => {
    if (!source || !seekRequest || !playerRef.current) return
    playerRef.current.currentTime = toMediaTimeSeconds(seekRequest.sessionMs, source.availableFromMs)
  }, [source, seekRequest])

  const handleProviderChange = (provider: MediaProviderAdapter | null) => {
    if (isHLSProvider(provider)) provider.library = HLS
  }

  const retryPlayback = () => {
    setPlaybackState('loading')
    onRetry()
  }

  const statusState: PlaybackState = errorMessage ? 'error' : loading ? 'loading' : playbackState

  return (
    <div aria-label="학생 라이브 영상" className="video-stage student-live-stage" role="region">
      {source
        ? (
          // key는 실제 재생 대상이 바뀔 때만 변한다. 폴링 갱신마다 리마운트하면 재생이 끊긴다.
          // streamType은 넘기지 않는다 — #EXT-X-ENDLIST 유무로 vidstack이 판정하므로
          // 라이브(live:dvr)/종료 후(on-demand)가 자동으로 갈린다.
          <MediaPlayer
            key={`${playback?.sessionId}-${source.url}-${reloadToken}`}
            ref={playerRef}
            autoPlay
            className="student-live-player"
            playsInline
            src={{ src: source.url, type: 'application/vnd.apple.mpegurl' }}
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

      <header className="student-live-status" aria-label="학생 라이브 재생 정보">
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
