import { useEffect, useRef } from 'react'
import type { LocalVideoTrack } from 'livekit-client'

interface InstructorLocalTrackVideoProps {
  track: LocalVideoTrack
  label: string
  fit?: 'cover' | 'contain'
  /** 자기 얼굴 미리보기만 거울처럼 표시하며 화면공유·합성 화면은 뒤집지 않는다. */
  mirrored?: boolean
  className?: string
  /**
   * 붙은 video element를 바깥에 알린다. 강조 캡처가 이 프레임을 잘라 쓴다(ADR-0074) —
   * DOM을 뒤져 찾으면 카메라 미리보기와 구분이 안 된다.
   */
  elementRef?: { current: HTMLVideoElement | null }
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
  elementRef,
}: InstructorLocalTrackVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    track.attach(element)
    if (elementRef) elementRef.current = element
    return () => {
      track.detach(element)
      if (elementRef) elementRef.current = null
    }
  }, [elementRef, track])

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
