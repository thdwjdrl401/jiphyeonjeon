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

function renderStage(overrides: Partial<InstructorLiveMedia> = {}) {
  publisher.current = {
    connectionState: 'connected',
    cameraEnabled: true,
    microphoneEnabled: true,
    screenShareEnabled: false,
    mediaRevision: 1,
    devices: [],
    activeDeviceId: () => undefined,
    switchDevice: vi.fn(),
    sessionId: 'ses-1',
    pendingControl: null,
    canControl: true,
    quality: DEFAULT_PUBLISH_QUALITY,
    changeQuality: vi.fn(),
    cameraOverlay: DEFAULT_CAMERA_OVERLAY,
    moveCameraOverlay: vi.fn(),
    publishAnnotation: vi.fn(),
    publishAnnotationState: vi.fn(),
    restoredAnnotationVisible: null,
    saveAnnotationVisible: vi.fn(),
    saveAnnotationSnapshot: vi.fn(),
    publishLaser: vi.fn(),
    annotationAudienceRevision: 0,
    restoredAnnotation: null,
    applyingQuality: false,
    retry: vi.fn(),
    toggleCamera: vi.fn(),
    toggleMicrophone: vi.fn(),
    toggleScreenShare: vi.fn(),
    demoAudio: { fileName: null, live: false, playing: false, loop: false, positionMs: 0, durationMs: 0 },
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

  /**
   * 컨트롤 줄은 <b>내보내는 것</b>과 <b>판서</b> 두 묶음이다. 예전에는 일곱 개가 같은 굵기로 한 줄에
   * 서서 서로 구분되지 않았고, 넷이 "켜짐/꺼짐"으로 끝나 정작 마이크 상태가 묻혔다(ADR-0101 §1).
   */
  it('컨트롤은 내보내는 것과 판서 두 묶음으로 갈린다', () => {
    const { container } = renderStage()

    expect(container.querySelectorAll('.control-row__group')).toHaveLength(2)
  })

  /**
   * 카메라를 내리는 방법은 <b>하나</b>다(ADR-0101 §2). 둘이던 시절 강사에게 이 둘은 구분되지 않는데
   * 결과는 정반대였다 — 하나는 검은 상자를 남기고 하나는 아무것도 남기지 않았다.
   *
   * <p>화질은 강의하는 중에 고를 일이 아니라 사전 점검에서 고른다(§4).
   */
  it('카메라 표시 토글과 화질 설정은 라이브 화면에 없다', () => {
    const { queryByRole } = renderStage()

    expect(queryByRole('button', { name: /수강생 화면에 카메라/ })).toBeNull()
    expect(queryByRole('button', { name: /화질/ })).toBeNull()
  })

  it('판서 토글은 기본이 꺼짐이다 — 켜져 있으면 카메라 배치를 드래그할 수 없다', () => {
    const { getByRole } = renderStage()

    expect(getByRole('button', { name: '판서' }).getAttribute('aria-pressed')).toBe('false')
  })

  /**
   * <b>서버에 남은 표시 상태대로 돌아온다</b>(ADR-0056).
   *
   * <p>예전에는 "저장된 요소가 있으면 켠다"였다. 그래서 강사가 판서를 <b>끄고</b> 나갔어도 새로고침하면
   * 멋대로 켜졌다 — 강사의 선택이 사라졌다. 표시 상태를 세션에 남기면 그 선택이 그대로 돌아온다.
   */
  it('서버에 켜짐으로 남아 있으면 켜진 채로 돌아온다', () => {
    const { getByRole } = renderStage({
      restoredAnnotation: { revision: 47, elements: [{ id: 'a', type: 'freedraw', version: 1 }], files: {} },
      restoredAnnotationVisible: true,
    } as Partial<InstructorLiveMedia>)

    expect(getByRole('button', { name: '판서' }).getAttribute('aria-pressed')).toBe('true')
  })

  /**
   * <b>요소가 있어도</b> 꺼진 채로 남겼으면 꺼진 채로 돌아온다. 이것이 예전과 갈리는 지점이다 —
   * 강사가 끈 것을 시스템이 되돌리면 안 된다.
   */
  it('그린 것이 있어도 꺼짐으로 남아 있으면 꺼진 채로 돌아온다', () => {
    const { getByRole } = renderStage({
      restoredAnnotation: { revision: 47, elements: [{ id: 'a', type: 'freedraw', version: 1 }], files: {} },
      restoredAnnotationVisible: false,
    } as Partial<InstructorLiveMedia>)

    expect(getByRole('button', { name: '판서' }).getAttribute('aria-pressed')).toBe('false')
  })

  /** 판서를 켜고 끄면 서버에 남긴다 — 그래야 다음 새로고침에 그대로 돌아온다. */
  it('판서를 켜면 표시 상태를 서버에 남긴다', () => {
    const saveAnnotationVisible = vi.fn()
    const { getByRole } = renderStage({ saveAnnotationVisible } as Partial<InstructorLiveMedia>)

    getByRole('button', { name: '판서' }).click()

    expect(saveAnnotationVisible).toHaveBeenCalledWith(true)
  })
})

/**
 * 시연 음성이 나가는 동안 <b>내 마이크는 꺼져 있다</b> — 트랙을 갈아끼우면서 LiveKit이 장치를
 * 멈추기 때문이다(ADR-0103). 그런데 publication은 살아 있어서 `microphoneEnabled`가 그대로
 * true였고, 버튼은 켜진 것처럼 보였다. <b>강사는 자기 목소리가 나가는 줄 안다.</b>
 */
describe('시연 음성 중 마이크 표시', () => {
  const live = {
    demoAudio: { fileName: 'demo.m4a', live: true, playing: true, loop: false, positionMs: 0, durationMs: 0 },
    microphoneEnabled: true,
  }

  it('내 마이크가 꺼진 것으로 보인다', () => {
    const { getByRole } = renderStage(live)

    const microphone = getByRole('button', { name: '마이크' })
    expect(microphone).toHaveAttribute('aria-pressed', 'false')
    expect(microphone.className).not.toContain('is-active')
  })

  /** 이 버튼이 할 수 있는 일(내 마이크 켜기)이 지금은 없다. 나가는 소리는 재생기에서 멎춘다. */
  it('누를 수 없고 왜 그런지 말한다', () => {
    const { getByRole } = renderStage(live)

    const microphone = getByRole('button', { name: '마이크' })
    expect(microphone).toBeDisabled()
    expect(microphone.getAttribute('title')).toContain('시연 음성')
  })

  it('시연 음성이 없으면 예전 그대로다', () => {
    const { getByRole } = renderStage({ microphoneEnabled: true })

    expect(getByRole('button', { name: '마이크' })).toHaveAttribute('aria-pressed', 'true')
  })
})
