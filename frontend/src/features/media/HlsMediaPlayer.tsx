import { useCallback, useEffect, useRef, useState } from 'react'
import HLS from 'hls.js'
import {
  isHLSProvider,
  MediaPlayer,
  MediaProvider,
  Track,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
} from '@vidstack/react'
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default'
import { formatTimeLabel } from '@/features/live-session/captionAdapter'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'

/**
 * `ended`는 <b>이 브라우저가 마지막 세그먼트까지 소비했다</b>는 뜻이다.
 *
 * <p>라이브에서 이것이 학생의 실제 시청 완료 신호다(ADR-0005 §3). 세션이 ENDED가 되는 시각과는
 * 다르다 — 강사 송출이 끝나도 인코딩·업로드·버퍼 지연만큼 볼 것이 남아 있다.
 */
export type HlsMediaState = 'loading' | 'ready' | 'playing' | 'buffering' | 'ended' | 'error'

/**
 * vidstack 컨트롤을 이 파일 밖(재생 정보 헤더 등)에서 idle 타이머와 무관하게 붙잡아 둘 수 있게
 * 좁힌 창구. vidstack의 전체 인스턴스 타입을 밖으로 새게 두지 않는다 — 필요한 두 동작만 노출한다.
 */
export interface HlsMediaControlsHandle {
  /** idle 상태여도 즉시 보이게 한다. */
  show: () => void
  /** delay(ms) 뒤 자동으로 숨긴다. 생략하면 vidstack 기본 idle 지연을 쓴다. */
  hide: (delay?: number) => void
}

export interface HlsMediaSeekRequest {
  mediaTimeSeconds: number
  sequence: number
}

export interface HlsCaptionTrack {
  trackId: string
  src: string
  kind: 'subtitles' | 'captions'
  label: string
  language: string
  default: boolean
  version: number
}

interface HlsMediaPlayerProps {
  sourceUrl: string
  title: string
  streamType: 'live:dvr' | 'on-demand'
  durationMs: number | null
  reloadToken: number
  seekRequest?: HlsMediaSeekRequest | null
  autoPlay?: boolean
  captionTracks?: HlsCaptionTrack[]
  className?: string
  onStateChange: (state: HlsMediaState) => void
  onTimeChange?: (mediaTimeMs: number) => void
  /** 컨트롤(재생바)이 뜨고 숨는 상태 — 재생 정보 헤더를 같은 타이밍으로 동기화하는 데 쓴다. */
  onControlsVisibleChange?: (visible: boolean) => void
  /** 헤더 등 플레이어 바깥 오버레이가 마우스 활동으로 idle 타이머를 함께 되돌릴 수 있게 인스턴스를 넘긴다. */
  onControlsHandle?: (handle: HlsMediaControlsHandle | null) => void
}

/** 라이브 DVR과 업로드 녹화강의가 공유하는 vidstack·hls.js 재생부. 도메인 상태 UI는 소유하지 않는다. */
/**
 * 라이브 컨트롤바의 경과 시각.
 *
 * <p>형식은 자막 라벨과 <b>같은 함수</b>를 쓴다(`formatTimeLabel`). 여기서 다시 구현하면 규칙이
 * 갈라져 언젠가 한쪽만 바뀐다 — 자막을 눌러 이동한 뒤 두 숫자가 어긋나면 사용자는 이동이 잘못된
 * 것으로 읽는다.
 *
 * <p>`tabular-nums`로 자릿수를 고정한다. 매초 바뀌는 숫자라 폭이 흔들리면 옆 컨트롤이 밀린다.
 */
function LiveElapsedTime({ mediaTimeMs }: { mediaTimeMs: number }) {
  return (
    <span className="vds-time live-elapsed-time" aria-label="재생 위치">
      {formatTimeLabel(mediaTimeMs)}
    </span>
  )
}

export default function HlsMediaPlayer({
  sourceUrl,
  title,
  streamType,
  durationMs,
  reloadToken,
  seekRequest = null,
  autoPlay = false,
  captionTracks = [],
  className = 'student-live-player',
  onStateChange,
  onTimeChange,
  onControlsVisibleChange,
  onControlsHandle,
}: HlsMediaPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const appliedSeekSequence = useRef(-1)
  const [liveDuration, setLiveDuration] = useState(-1)
  const isLive = streamType === 'live:dvr'
  // 라이브 컨트롤바에 찍을 경과 시각. 라이브가 아니면 vidstack이 이미 시간을 그리므로 쓰지 않는다.
  const [elapsedMs, setElapsedMs] = useState(0)

  // useCallback으로 참조를 고정한다 — 콜백 ref는 정체성이 바뀔 때마다 React가 떼었다 다시 붙이므로,
  // 매 렌더 새 함수를 주면 매번 인스턴스를 null로 지웠다 되살리는 헛수고가 생긴다.
  const setPlayerRef = useCallback((instance: MediaPlayerInstance | null) => {
    playerRef.current = instance
    onControlsHandle?.(instance
      ? { show: () => instance.controls.show(), hide: (delay) => instance.controls.hide(delay) }
      : null)
  }, [onControlsHandle])

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
      ref={setPlayerRef}
      autoPlay={autoPlay}
      className={className}
      // vidstack 기본 idle 지연(2000ms)을 그대로 쓴다 — 예전에 여기를 600ms로 줄였던 적이 있는데,
      // 재생바가 너무 빨리 사라진다는 이유로 되돌렸다. 재생 정보 헤더는 이 컨트롤 표시 상태
      // (onControlsVisibleChange)를 그대로 따라가므로 지연을 여기 한 곳에서만 관리하면 된다.
      duration={providedDuration}
      playsInline
      src={{ src: sourceUrl, type: 'application/vnd.apple.mpegurl' }}
      streamType={streamType}
      title={title}
      onCanPlay={() => onStateChange('ready')}
      onControlsChange={(visible) => onControlsVisibleChange?.(visible)}
      onEnded={() => onStateChange('ended')}
      onError={() => onStateChange('error')}
      onPlaying={() => onStateChange('playing')}
      onProviderChange={handleProviderChange}
      onTimeUpdate={(detail) => {
        const mediaTimeMs = Math.max(0, Math.round(detail.currentTime * 1000))
        if (isLive) setElapsedMs(mediaTimeMs)
        onTimeChange?.(mediaTimeMs)
      }}
      onWaiting={() => onStateChange('buffering')}
    >
      <MediaProvider>
        {captionTracks.map((track) => (
          <Track
            key={`${track.trackId}-${track.version}`}
            id={track.trackId}
            src={track.src}
            type="vtt"
            kind={track.kind}
            label={track.label}
            lang={track.language}
            default={track.default}
          />
        ))}
      </MediaProvider>
      {/*
        라이브에서는 vidstack이 시간 대신 LIVE 배지만 보인다(streamType='live:dvr'). 되감아도 지금
        어디를 보고 있는지 알 수 없고, 자막 시각을 눌러 이동해도 확인할 대상이 없다.

        <p>그래서 <b>LIVE 배지 옆, 원래 시간이 나오던 자리</b>에 경과 시각을 넣는다. 별도 헤더에 두면
        눈이 가지 않는다 — 사람이 시간을 찾는 곳은 컨트롤바다.

        <p>다시보기(on-demand)에는 넣지 않는다. vidstack이 이미 `mm:ss / 총길이`를 그 자리에 그린다.
      */}
      <DefaultVideoLayout
        icons={defaultLayoutIcons}
        slots={isLive ? { afterLiveButton: <LiveElapsedTime mediaTimeMs={elapsedMs} /> } : undefined}
      />
    </MediaPlayer>
  )
}
