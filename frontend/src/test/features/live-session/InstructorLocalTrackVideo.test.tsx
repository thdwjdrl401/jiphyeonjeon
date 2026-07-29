import { render, screen } from '@testing-library/react'
import type { LocalVideoTrack } from 'livekit-client'
import { describe, expect, it, vi } from 'vitest'
import InstructorLocalTrackVideo from '@/features/live-session/InstructorLocalTrackVideo'

function localTrack() {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
  } as unknown as LocalVideoTrack
}

describe('InstructorLocalTrackVideo', () => {
  it('LocalVideoTrack을 video에 연결하고 트랙 교체·unmount 때 해제한다', () => {
    const firstTrack = localTrack()
    const secondTrack = localTrack()
    const { rerender, unmount } = render(
      <InstructorLocalTrackVideo
        fit="contain"
        label="사전 점검 카메라 미리보기"
        mirrored
        track={firstTrack}
      />,
    )
    const video = screen.getByLabelText('사전 점검 카메라 미리보기')

    expect(video).toBeInstanceOf(HTMLVideoElement)
    expect(video).toHaveClass('instructor-local-video--contain')
    expect(video).toHaveClass('is-mirrored')
    expect(firstTrack.attach).toHaveBeenCalledWith(video)

    rerender(
      <InstructorLocalTrackVideo
        fit="contain"
        label="사전 점검 카메라 미리보기"
        mirrored
        track={secondTrack}
      />,
    )
    expect(firstTrack.detach).toHaveBeenCalledWith(video)
    expect(secondTrack.attach).toHaveBeenCalledWith(video)

    unmount()
    expect(secondTrack.detach).toHaveBeenCalledWith(video)
  })
})
