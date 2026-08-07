import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import type { LocalVideoTrack } from 'livekit-client'
import { describe, expect, it, vi } from 'vitest'
import InstructorLiveKitStage from '@/features/live-session/InstructorLiveKitStage'
import { DEFAULT_CAMERA_OVERLAY } from '@/features/live-session/cameraOverlay'
import { DEFAULT_PUBLISH_QUALITY } from '@/features/live-session/publishQuality'
import type { InstructorLiveMedia } from '@/features/live-session/useInstructorLiveKit'

const publisher = vi.hoisted(() => ({ current: null as InstructorLiveMedia | null }))

vi.mock('@/features/live-session/useInstructorLiveKit', () => ({
  useInstructorLiveKit: () => publisher.current,
}))

function localTrack() {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as LocalVideoTrack
}

function renderStage(overrides: Partial<InstructorLiveMedia>) {
  publisher.current = {
    connectionState: 'connected',
    cameraEnabled: true,
    microphoneEnabled: true,
    screenShareEnabled: false,
    mediaRevision: 1,
    sessionId: 'ses-1',
    pendingControl: null,
    canControl: true,
    quality: DEFAULT_PUBLISH_QUALITY,
    changeQuality: vi.fn(),
    cameraOverlay: DEFAULT_CAMERA_OVERLAY,
    moveCameraOverlay: vi.fn(),
    applyingQuality: false,
    retry: vi.fn(),
    toggleCamera: vi.fn(),
    toggleMicrophone: vi.fn(),
    toggleScreenShare: vi.fn(),
    ...overrides,
  } as InstructorLiveMedia
  return render(
    <InstructorLiveKitStage
      lessonTitle="Spring Security 시작하기"
      participantCount={3}
      sessionId="ses-1"
      onRequestEnd={vi.fn()}
    />,
  )
}

/**
 * 좌우 반전 규칙: 강사는 자기 카메라를 거울로 보고 그 화면을 기준으로 움직이므로, 수강생에게도
 * 같은 방향으로 나가야 한다. 다만 뒤집기는 <b>카메라에만</b> 걸려야 한다 — 화면공유까지 뒤집으면
 * 슬라이드·코드의 글자가 반전돼 강의가 읽히지 않는다.
 */
describe('카메라 좌우 반전 범위', () => {
  it('카메라만 송출할 때 미리보기를 거울로 그린다', () => {
    renderStage({ cameraTrack: localTrack() })
    expect(screen.getByLabelText('카메라 미리보기')).toHaveClass('is-mirrored')
  })

  it('화면공유 미리보기는 뒤집지 않는다', () => {
    renderStage({ screenShareEnabled: true, screenShareTrack: localTrack(), cameraEnabled: false })
    expect(screen.getByLabelText('공유 화면 미리보기')).not.toHaveClass('is-mirrored')
  })

  it('화면공유 위에 얹히는 카메라도 거울로 그린다 — 합성 결과와 같아야 한다', () => {
    renderStage({
      cameraTrack: localTrack(),
      screenShareEnabled: true,
      screenShareTrack: localTrack(),
    })
    expect(screen.getByLabelText('공유 화면 미리보기')).not.toHaveClass('is-mirrored')
    expect(screen.getByLabelText('카메라 미리보기')).toHaveClass('is-mirrored')
  })

  it('카메라 편집기는 합성 캔버스 안에 놓여 같은 좌표계를 쓴다', () => {
    const { container } = renderStage({
      cameraTrack: localTrack(),
      screenShareEnabled: true,
      screenShareTrack: localTrack(),
    })
    const canvas = container.querySelector('.instructor-media-canvas')
    expect(canvas).not.toBeNull()
    // 편집기가 캔버스 밖(비율이 다른 미리보기 영역)에 있으면 같은 0~1 값이 다른 자리를 가리킨다.
    expect(canvas?.querySelector('.camera-overlay-frame')).not.toBeNull()
  })
})

function ruleBody(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} 규칙을 찾지 못했습니다`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

/**
 * 합성 캔버스(Egress 템플릿)는 헤드리스 Chrome이 그려 그대로 HLS가 된다. 여기서 뒤집는 대상이
 * 넓어지면 수강생 화면의 글자가 통째로 반전되므로, 적용 범위를 스타일 수준에서 못 박는다.
 */
describe('합성 캔버스의 반전 범위', () => {
  const egressCss = readFileSync(resolve(process.cwd(), 'src/styles/egress-stage.css'), 'utf8')
  const learningCss = readFileSync(resolve(process.cwd(), 'src/styles/learning.css'), 'utf8')

  it('카메라 트랙만 뒤집는다', () => {
    // 뒤집기는 이제 조건부다 — 웹캠은 거울, 파일 송출은 그대로(ADR-0100).
    expect(ruleBody(egressCss, '.egress-stage__camera.is-mirrored')).toContain('transform: scaleX(-1)')
    // 조건 없는 규칙에는 남아 있으면 안 된다. 남으면 파일 송출도 뒤집혀 VOD에 영구히 남는다.
    expect(ruleBody(egressCss, '.egress-stage__camera')).not.toContain('transform')
  })

  it('화면공유와 캔버스 자체는 뒤집지 않는다', () => {
    expect(ruleBody(egressCss, '.egress-stage__screen')).not.toContain('transform')
    expect(ruleBody(egressCss, '.egress-stage')).not.toContain('transform')
  })

  it('강사 화면의 반전도 카메라 video 한 장에만 걸린다', () => {
    expect(ruleBody(learningCss, '.instructor-local-video.is-mirrored')).toContain('transform: scaleX(-1)')
    expect(ruleBody(learningCss, '.instructor-media-canvas')).not.toContain('transform')
  })
})
