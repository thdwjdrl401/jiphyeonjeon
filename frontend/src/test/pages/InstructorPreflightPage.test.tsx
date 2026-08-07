import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InstructorPreflightPage from '@/pages/InstructorPreflightPage'
import { ToastProvider } from '@/shared/ui/Toast'
import type { InstructorLiveMedia } from '@/features/live-session/useInstructorLiveKit'

const getLiveSession = vi.fn()
const getPreflightReadiness = vi.fn()
const getLiveStartStatus = vi.fn()
const startLiveSession = vi.fn()

vi.mock('@/features/live-session/liveSessionService', () => ({
  getLiveSession: (...args: unknown[]) => getLiveSession(...args),
  getPreflightReadiness: (...args: unknown[]) => getPreflightReadiness(...args),
  getLiveStartStatus: (...args: unknown[]) => getLiveStartStatus(...args),
  startLiveSession: (...args: unknown[]) => startLiveSession(...args),
}))

/** 화면만 보려는 테스트다. LiveKit 연결은 붙어 있는 것으로 고정한다. */
let publisher: Partial<InstructorLiveMedia>
vi.mock('@/features/live-session/useInstructorLiveKit', () => ({
  useInstructorLiveKit: () => publisher,
}))

/**
 * 시연 스위치는 운영 계정에게만 보인다(ADR-0100). 이 파일의 기존 테스트는 <b>평범한 강사</b>를
 * 가정하므로 그렇게 고정하고, 보이지 않는다는 것 자체를 아래에서 한 번 못 박는다.
 */
let currentUser: { isAdmin: boolean } | null = { isAdmin: false }
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}))

const SESSION = 'ses-1'

function readiness(overrides: Partial<{
  ready: boolean
  microphonePublished: boolean
  microphoneMuted: boolean
  instructorMicrophoneTrackCount: number
}> = {}) {
  return {
    ready: true,
    instructorPresent: true,
    microphonePublished: true,
    microphoneMuted: false,
    instructorMicrophoneTrackCount: 1,
    unexpectedMicrophonePublishers: 0,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/instructor/live-sessions/${SESSION}/preflight`]}>
          <Routes>
            <Route path="/instructor/live-sessions/:sessionId/preflight" element={<InstructorPreflightPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('강사 사전 점검', () => {
  beforeEach(() => {
    currentUser = { isAdmin: false }
    publisher = {
      connectionState: 'connected',
      cameraEnabled: false,
      microphoneEnabled: true,
      screenShareEnabled: false,
      mediaRevision: 1,
      pendingControl: null,
      canControl: true,
      microphonePermission: 'granted',
      quality: { camera: 'fhd', screenShare: 'text' },
      retry: vi.fn(),
      retryMedia: vi.fn(),
      dismissMediaFailure: vi.fn(),
      toggleCamera: vi.fn(),
      toggleMicrophone: vi.fn(),
      toggleScreenShare: vi.fn(),
      changeQuality: vi.fn(),
      applyingQuality: false,
    } as Partial<InstructorLiveMedia>
    getLiveSession.mockResolvedValue({
      sessionId: SESSION,
      status: 'OPEN',
      lessonId: 'les-1',
      lessonTitle: '스프링 시큐리티',
      sectionId: 'sec-1',
      sectionTitle: '기초',
      curriculumId: 'cur-1',
      curriculumTitle: '스프링 라이브',
    })
    getPreflightReadiness.mockResolvedValue(readiness())
    getLiveStartStatus.mockResolvedValue(undefined)
  })

  it('마이크가 준비되면 그대로 시작할 수 있다', async () => {
    renderPage()

    expect(await screen.findByText('라이브 시작 준비 완료')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '라이브 시작' })).toBeEnabled()
  })

  /**
   * ADR-0099. 마이크가 없다고 강의를 못 열 이유는 없다. 다만 <b>무엇을 잃는지</b>는 눌리기 전에
   * 말해야 한다 — 무음은 조용히 실패해서 알려 주지 않으면 강의가 끝난 뒤에야 드러난다(ADR-0048).
   */
  it('마이크가 없어도 시작을 막지 않고, 무엇을 잃는지 말한다', async () => {
    publisher = { ...publisher, microphoneEnabled: false }
    getPreflightReadiness.mockResolvedValue(readiness({
      microphonePublished: false,
      instructorMicrophoneTrackCount: 0,
    }))
    renderPage()

    expect(await screen.findByText('마이크 없이 시작 준비됨')).toBeInTheDocument()
    expect(screen.getByText('소리 없이 송출됩니다 — 녹화와 자막에도 소리가 남지 않습니다.')).toBeInTheDocument()
    // 예전에는 여기서 버튼이 잠겨 있었다.
    expect(screen.getByRole('button', { name: '라이브 시작' })).toBeEnabled()
    expect(screen.getByText('소리 없음')).toBeInTheDocument()
    // 게이지는 마이크를 켜면 여기서 소리를 확인하겠다고 자리를 지킨다(ADR-0099 §5).
    expect(screen.getByText('마이크를 켜면 여기서 소리를 확인합니다')).toBeInTheDocument()
  })

  it('음소거로 두고 시작해도 막지 않되 같은 경고를 낸다', async () => {
    getPreflightReadiness.mockResolvedValue(readiness({ microphoneMuted: true }))
    renderPage()

    expect(await screen.findByText('마이크 없이 시작 준비됨')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '라이브 시작' })).toBeEnabled()
    expect(screen.getByText('음소거됨')).toBeInTheDocument()
  })

  /** 마이크가 없어도 서버 점검은 돌아야 한다 — 예전에는 게이트라서 조회가 아예 시작되지 않았다. */
  it('마이크가 없어도 서버 점검을 시작한다', async () => {
    publisher = { ...publisher, microphoneEnabled: false }
    getPreflightReadiness.mockResolvedValue(readiness({
      microphonePublished: false,
      instructorMicrophoneTrackCount: 0,
    }))
    renderPage()

    await waitFor(() => { expect(getPreflightReadiness).toHaveBeenCalledWith(SESSION) })
  })

  it('강사가 방에 없으면 여전히 시작할 수 없다', async () => {
    getPreflightReadiness.mockResolvedValue(readiness({ ready: false, microphonePublished: false }))
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '라이브 시작' })).toBeDisabled()
    })
  })

  it('마이크 권한이 차단이면 점검 항목이 그렇게 말한다', async () => {
    publisher = { ...publisher, microphonePermission: 'denied' }
    renderPage()

    expect(await screen.findByText('차단됨')).toBeInTheDocument()
  })

  /**
   * 시연 스위치는 운영 계정에게만 보인다(ADR-0100). 평범한 강사에게 보이면 실수로 켤 수 있고,
   * 데모 모드의 화면은 평소와 <b>완전히 같아서</b> 켠 줄 모른 채 수업을 진행하게 된다.
   */
  it('데모 스위치는 평범한 강사에게 보이지 않는다', async () => {
    currentUser = { isAdmin: false }
    renderPage()

    await screen.findByRole('button', { name: '라이브 시작' })
    expect(screen.queryByRole('button', { name: '데모 영상 선택' })).not.toBeInTheDocument()
  })

  /**
   * 스위치는 <b>송출 장치 패널</b>에 산다 — 하는 일이 "무엇을 송출할지 고르는 것"이라 미리보기
   * 바로 아래가 제자리고, 고른 결과가 위 화면에 그대로 보인다.
   *
   * <p><b>시작 바에는 둘 수 없다.</b> 그 바는 칸이 셋인 그리드(`auto minmax(0,1fr) auto`)라 네 번째
   * 자식을 넣으면 배치가 깨지고, 바탕이 `--ink-950`이라 잉크색 글자가 보이지 않는다. 실제로 그렇게
   * 넣었다가 둘 다 겪었다.
   */
  it('운영 계정에게 데모 스위치를 보여주되 시작 바에는 넣지 않는다', async () => {
    currentUser = { isAdmin: true }
    publisher = { ...publisher, demoPublish: { armed: false, ready: false, fileName: null, hasAudio: false } }
    const { container } = renderPage()

    const demoButton = await screen.findByRole('button', { name: '데모 영상 선택' })
    // 시작 버튼을 대체하지 않는다 — 데모로 켜 두고 평소처럼 시작하는 흐름이다.
    expect(screen.getByRole('button', { name: '라이브 시작' })).toBeInTheDocument()

    const startBar = container.querySelector('.instructor-preflight__actions')
    expect(startBar).not.toBeNull()
    expect(startBar).not.toContainElement(demoButton)
    expect(demoButton.closest('.instructor-preflight__device-panel')).not.toBeNull()
  })
})
