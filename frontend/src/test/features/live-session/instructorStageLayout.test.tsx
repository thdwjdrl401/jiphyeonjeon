import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InstructorLiveKitStage from '@/features/live-session/InstructorLiveKitStage'
import { DEFAULT_CAMERA_OVERLAY } from '@/features/live-session/cameraOverlay'
import { DEFAULT_PUBLISH_QUALITY } from '@/features/live-session/publishQuality'
import type { InstructorLiveMedia } from '@/features/live-session/useInstructorLiveKit'

const publisher = vi.hoisted(() => ({ current: null as InstructorLiveMedia | null }))

vi.mock('@/features/live-session/useInstructorLiveKit', () => ({
  useInstructorLiveKit: () => publisher.current,
}))

function renderStage() {
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
    publishAnnotation: vi.fn(),
    publishLaser: vi.fn(),
    annotationAudienceRevision: 0,
    applyingQuality: false,
    retry: vi.fn(),
    toggleCamera: vi.fn(),
    toggleMicrophone: vi.fn(),
    toggleScreenShare: vi.fn(),
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
 * 강사 스테이지는 <b>호버 오버레이를 쓰지 않고</b> 위아래로 영역을 나눈다:
 * 강의 정보 띠 → 미디어 → 송출 컨트롤.
 *
 * 판서가 들어오면서 필요해진 규칙이다. 오버레이가 미디어 위에 떠 있으면 그리는 동안 마우스가 계속
 * 미디어 위에 있어 항상 떠 있는 셈이고, 상·하단을 덮어 Excalidraw 툴바와 되돌리기 버튼을 가린다.
 *
 * 스타일은 flex 컬럼이라 <b>DOM 순서가 곧 위아래</b>다. 실제로 정보 띠가 미디어 뒤에 있어서 화면
 * 아래로 내려가 하단 컨트롤에 가려진 적이 있다 — CSS만으로는 드러나지 않아 이 순서를 고정한다.
 */
describe('강사 스테이지 배치', () => {
  it('강의 정보 띠 → 미디어 → 컨트롤 순서로 둔다', () => {
    const { container } = renderStage()

    const parts = [...container.querySelectorAll(
      '.video-status-overlay, .instructor-media-preview, .video-controls-overlay',
    )].map((element) => {
      if (element.classList.contains('video-status-overlay')) return '정보'
      if (element.classList.contains('instructor-media-preview')) return '미디어'
      return '컨트롤'
    })

    expect(parts).toEqual(['정보', '미디어', '컨트롤'])
  })

  it('전체화면 버튼은 컨트롤 줄 오른쪽 끝에 아이콘으로 둔다', () => {
    const { container } = renderStage()

    const button = container.querySelector('.video-controls-overlay__icon')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toBe('전체화면')
    // 글자 없이 아이콘만 — 영상 플레이어의 그 버튼처럼 읽혀야 한다.
    expect(button?.textContent?.trim()).toBe('')
    expect(button?.querySelector('svg')).not.toBeNull()
    // 컨트롤 줄 안에 있어야 한다(별도로 떠 있으면 컨트롤과 겹친다).
    expect(button?.closest('.video-controls-overlay')).not.toBeNull()
  })

  it('판서 토글은 기본이 꺼짐이다 — 켜져 있으면 카메라 배치를 드래그할 수 없다', () => {
    const { getByRole } = renderStage()

    expect(getByRole('button', { name: /판서/ }).getAttribute('aria-pressed')).toBe('false')
  })
})
