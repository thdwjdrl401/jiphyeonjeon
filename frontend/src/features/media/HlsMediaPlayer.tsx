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

export type HlsMediaState = 'loading' | 'ready' | 'playing' | 'buffering' | 'error'

export interface HlsMediaSeekRequest {
  mediaTimeSeconds: number
  sequence: number
}

interface HlsMediaPlayerProps {
  sourceUrl: string
  title: string
  streamType: 'live:dvr' | 'on-demand'
  durationMs: number | null
  reloadToken: number
  seekRequest?: HlsMediaSeekRequest | null
  autoPlay?: boolean
  className?: string
  onStateChange: (state: HlsMediaState) => void
  onTimeChange?: (mediaTimeMs: number) => void
}

/** 라이브 DVR과 업로드 녹화강의가 공유하는 vidstack·hls.js 재생부. 도메인 상태 UI는 소유하지 않는다. */
export default function HlsMediaPlayer({
  sourceUrl,
  title,
  streamType,
  durationMs,
  reloadToken,
  seekRequest = null,
  autoPlay = false,
  className = 'student-live-player',
  onStateChange,
  onTimeChange,
}: HlsMediaPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const appliedSeekSequence = useRef(-1)
  const [liveDuration, setLiveDuration] = useState(-1)
  const isLive = streamType === 'live:dvr'

  useEffect(() => {
    setLiveDuration(-1)
    appliedSeekSequence.current = -1
    onStateChange('loading')
  }, [sourceUrl, reloadToken, onStateChange])

  useEffect(() => {
    if (!seekRequest || !playerRef.current) return
    if (appliedSeekSequence.current === seekRequest.sequence) return
    appliedSeekSequence.current = seekRequest.sequence
    playerRef.current.currentTime = Math.max(0, seekRequest.mediaTimeSeconds)
  }, [seekRequest])

  const handleProviderChange = (provider: MediaProviderAdapter | null) => {
    if (!isHLSProvider(provider)) return
    provider.library = HLS
    if (!isLive) return
    provider.config = {
      // 라이브 엣지에서 2개 세그먼트 뒤를 유지하고, 버퍼링으로 밀리면 천천히 따라잡는다.
      liveSyncDurationCount: 2,
      maxLiveSyncPlaybackRate: 1.05,
    }
    provider.onInstance((instance) => {
      instance.on(HLS.Events.LEVEL_UPDATED, (_event, data) => {
        const total = data.details.totalduration
        if (total > 0) setLiveDuration(total)
      })
    })
  }

  const providedDuration = isLive
    ? liveDuration
    : durationMs && durationMs > 0
      ? durationMs / 1000
      : -1

  return (
    <MediaPlayer
      key={`${sourceUrl}-${reloadToken}`}
      ref={playerRef}
      autoPlay={autoPlay}
      className={className}
      duration={providedDuration}
      playsInline
      src={{ src: sourceUrl, type: 'application/vnd.apple.mpegurl' }}
      streamType={streamType}
      title={title}
      onCanPlay={() => onStateChange('ready')}
      onError={() => onStateChange('error')}
      onPlaying={() => onStateChange('playing')}
      onProviderChange={handleProviderChange}
      onTimeUpdate={(detail) => onTimeChange?.(Math.max(0, Math.round(detail.currentTime * 1000)))}
      onWaiting={() => onStateChange('buffering')}
    >
      <MediaProvider />
      <DefaultVideoLayout icons={defaultLayoutIcons} />
    </MediaPlayer>
  )
}
