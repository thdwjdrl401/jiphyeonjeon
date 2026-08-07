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
})
