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
import type { LivePlaybackView } from './liveSessionService.interface'

export interface StudentLiveSeekRequest {
  sessionMs: number
  sequence: number
}

interface StudentLivePlayerProps {
  playback: LivePlaybackView | null
  playbackKey: number
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

export function toSessionMs(mediaTimeSeconds: number, sessionOffsetMs: number | null) {
  return Math.max(0, Math.round(mediaTimeSeconds * 1000 + (sessionOffsetMs ?? 0)))
}

export function toMediaTimeSeconds(sessionMs: number, sessionOffsetMs: number | null) {
  return Math.max(0, (sessionMs - (sessionOffsetMs ?? 0)) / 1000)
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
  playbackKey,
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

  useEffect(() => setPlaybackState('loading'), [playback?.playbackUrl, playbackKey])

  useEffect(() => {
    if (!playback || !seekRequest || !playerRef.current) return
    playerRef.current.currentTime = toMediaTimeSeconds(seekRequest.sessionMs, playback.sessionOffsetMs)
  }, [playback, seekRequest])

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
      {playback
        ? (
          <MediaPlayer
            key={`${playback.sessionId}-${playback.playbackUrl}-${playbackKey}`}
            ref={playerRef}
            autoPlay
            className="student-live-player"
            playsInline
            src={{ src: playback.playbackUrl, type: playback.mimeType }}
            streamType="live:dvr"
            title={lessonTitle}
            onCanPlay={() => setPlaybackState('ready')}
            onError={() => setPlaybackState('error')}
            onPlaying={() => setPlaybackState('playing')}
            onProviderChange={handleProviderChange}
            onTimeUpdate={(detail) => onSessionTimeChange(toSessionMs(detail.currentTime, playback.sessionOffsetMs))}
            onWaiting={() => setPlaybackState('buffering')}
          >
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>
        )
        : (
          <div className={`student-live-empty${errorMessage ? ' student-live-empty--error' : ''}`} role={errorMessage ? 'alert' : 'status'}>
            <strong>{errorMessage ? '라이브 영상을 불러오지 못했습니다.' : loading ? '라이브 재생 주소를 불러오고 있습니다.' : '라이브 영상 연결을 준비하고 있습니다.'}</strong>
            <p>{errorMessage ?? (loading ? '현재 세션의 HLS DVR 주소를 확인하고 있습니다.' : '녹화 안내를 확인하면 라이브 영상에 연결합니다.')}</p>
            {errorMessage && <button className="button button--soft button--small" type="button" onClick={retryPlayback}>다시 시도</button>}
          </div>
        )}

      {playback && playbackState === 'error' && (
        <div className="student-live-empty student-live-empty--error" role="alert">
          <strong>HLS 영상을 재생하지 못했습니다.</strong>
          <p>현재 세션의 재생 주소를 다시 받은 뒤 연결을 재시도해 주세요.</p>
          <button className="button button--soft button--small" type="button" onClick={retryPlayback}>재생 주소 다시 받기</button>
        </div>
      )}

      <header className="student-live-status" aria-label="학생 라이브 재생 정보">
        <div>
          <span className="live-dot" aria-hidden="true" />
          <strong>LIVE</strong>
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
