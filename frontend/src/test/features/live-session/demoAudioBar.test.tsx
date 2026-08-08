import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DemoAudioBar from '@/features/live-session/DemoAudioBar'
import type { DemoAudioState } from '@/features/live-session/demoAudio'

/**
 * 시연 음성 재생기(ADR-0103).
 *
 * <p>여기서 지키는 것 둘. <b>하나</b>, 시연 도구는 시연하는 사람에게만 보인다 — 평소 강의 화면에
 * 이 줄이 서 있으면 강사가 눌러 보게 되고, 그러면 수업 중에 녹음이 나간다. <b>둘</b>, 나가는 소리를
 * 멎게 할 자리가 여기 있어야 한다 — 컨트롤 줄의 마이크 버튼은 재생 중에 잠긴다.
 */
const auth = vi.hoisted(() => ({ user: { isAdmin: false } as { isAdmin: boolean } | null }))
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth }))

const publisher = vi.hoisted(() => ({
  demoAudio: { fileName: null, live: false, playing: false, loop: false, positionMs: 0, durationMs: 0 } as DemoAudioState,
  microphoneEnabled: true,
  selectDemoAudioFile: vi.fn(),
  clearDemoAudioFile: vi.fn(),
  startDemoAudio: vi.fn(),
  stopDemoAudio: vi.fn(),
  pauseDemoAudio: vi.fn(),
  resumeDemoAudio: vi.fn(),
  seekDemoAudio: vi.fn(),
  setDemoAudioLoop: vi.fn(),
  toggleMicrophone: vi.fn(),
}))
vi.mock('@/features/live-session/useInstructorLiveKit', () => ({ useInstructorLiveKit: () => publisher }))

function setUp(overrides: Partial<DemoAudioState> = {}, isAdmin = true) {
  auth.user = { isAdmin }
  publisher.demoAudio = { ...publisher.demoAudio, ...overrides }
  return render(<DemoAudioBar />)
}

describe('시연 음성 재생기', () => {
  it('admin이 아니면 아무것도 그리지 않는다', () => {
    const { container } = setUp({}, false)

    expect(container).toBeEmptyDOMElement()
  })

  it('로그인하지 않았어도 그리지 않는다', () => {
    auth.user = null
    const { container } = render(<DemoAudioBar />)

    expect(container).toBeEmptyDOMElement()
  })

  it('admin에게는 파일 선택이 보인다', () => {
    setUp({ fileName: null })

    expect(screen.getByRole('button', { name: /시연 음성 선택/ })).toBeTruthy()
  })

  /** 고르는 것과 트는 것은 다르다 — 골랐다고 소리가 나가면 인사도 못 한다. */
  it('파일을 골라 두어도 재생 버튼일 뿐이다', () => {
    setUp({ fileName: 'demo.m4a', live: false })

    expect(screen.getByRole('button', { name: /재생/ })).toBeTruthy()
    expect(screen.queryByRole('slider', { name: '재생 위치' })).toBeNull()
  })

  it('재생 중에는 재생바와 복귀 버튼이 선다', () => {
    setUp({ fileName: 'demo.m4a', live: true, playing: true, positionMs: 30_000, durationMs: 180_000 })

    expect(screen.getByRole('slider', { name: '재생 위치' })).toHaveValue('30000')
    expect(screen.getByText('0:30 / 3:00')).toBeTruthy()
    expect(screen.getByRole('button', { name: /마이크로 복귀/ })).toBeTruthy()
  })

  /**
   * 컨트롤 줄의 마이크 버튼은 재생 중에 잠긴다(내 마이크는 이미 꺼져 있다). 그래서 나가는 소리를
   * 멎게 할 자리가 여기 없으면 <b>아무 데도 없다</b>.
   */
  it('재생 중에는 나가는 소리를 멎게 할 음소거가 있다', () => {
    setUp({ fileName: 'demo.m4a', live: true, playing: true })

    const mute = screen.getByRole('button', { name: /음소거/ })
    mute.click()

    expect(publisher.toggleMicrophone).toHaveBeenCalled()
  })

  it('시연 중이라는 사실을 계속 말한다', () => {
    setUp({ fileName: 'demo.m4a', live: true, playing: true })

    expect(screen.getByRole('status').textContent).toContain('마이크 자리로 나가는 중')
  })
})
