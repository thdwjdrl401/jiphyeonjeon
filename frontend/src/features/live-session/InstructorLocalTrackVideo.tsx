import { useEffect, useRef } from 'react'
import type { LocalVideoTrack } from 'livekit-client'

interface InstructorLocalTrackVideoProps {
  track: LocalVideoTrack
  label: string
  fit?: 'cover' | 'contain'
  /** 자기 얼굴 미리보기만 거울처럼 표시하며 화면공유·합성 화면은 뒤집지 않는다. */
  mirrored?: boolean
  className?: string
}

/**
 * LiveKit local video track을 실제 video element에 연결한다.
 * track이 교체되거나 화면에서 사라지면 기존 element 연결도 함께 해제한다.
 */
export default function InstructorLocalTrackVideo({
  track,
  label,
  fit = 'cover',
  mirrored = false,
  className,
}: InstructorLocalTrackVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    track.attach(element)
    return () => {
      track.detach(element)
    }
  }, [track])

  return (
    <video
      aria-label={label}
      autoPlay
      className={[
        'instructor-local-video',
        `instructor-local-video--${fit}`,
        mirrored ? 'is-mirrored' : undefined,
        className,
      ].filter(Boolean).join(' ')}
      muted
      playsInline
      ref={videoRef}
    />
  )
}
