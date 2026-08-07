import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessingStatus } from '@/features/live-session/liveSessionService.interface'
import LiveSessionProcessingPage from '@/pages/LiveSessionProcessingPage'

const getProcessingStatus = vi.fn()
const getLiveSession = vi.fn()
const getLesson = vi.fn()

vi.mock('@/features/live-session/liveSessionService', () => ({
  getProcessingStatus: (...args: unknown[]) => getProcessingStatus(...args),
  getLiveSession: (...args: unknown[]) => getLiveSession(...args),
}))

vi.mock('@/features/lesson/lessonService', () => ({
  getLesson: (...args: unknown[]) => getLesson(...args),
}))

function status(videoStatus: 'READY' | 'FAILED', replayStatus: 'DRAFT' | 'PUBLISHED'): ProcessingStatus {
  return {
    sessionId: 'ses-1',
    liveSessionStatus: 'ENDED',
    recordingEnabled: true,
    startedAt: '2026-08-01T10:00:00+09:00',
    endedAt: '2026-08-01T11:32:00+09:00',
    videoAsset: {
      videoAssetId: 'asset-1',
      status: videoStatus,
      replayStatus,
      failureCode: videoStatus === 'FAILED' ? 'MANIFEST_MISSING' : null,
      durationMs: videoStatus === 'READY' ? 60_000 : null,
      sizeBytes: videoStatus === 'READY' ? 10_000 : null,
      recordingStartedAt: '2026-08-01T10:00:04+09:00',
      recordingEndedAt: '2026-08-01T11:32:00+09:00',
    },
  }
}

function ReplayDestination() {
  const navigate = useNavigate()
  return <><h1>다시보기 도착</h1><button type="button" onClick={() => navigate(-1)}>뒤로</button></>
}

function renderPage(processing: ProcessingStatus) {
  getProcessingStatus.mockResolvedValue(processing)
  getLiveSession.mockResolvedValue({ sessionId: 'ses-1', lessonId: 'les-1' })
  getLesson.mockResolvedValue({
    lessonId: 'les-1',
    title: '테스트 강의',
    description: '',
    status: 'PUBLISHED',
    sectionId: 'sec-1',
    sectionTitle: '섹션',
    curriculumId: 'cur-1',
    curriculumTitle: '커리큘럼',
    materials: [],
    liveSession: null,
    replayStatus: processing.videoAsset?.replayStatus ?? null,
    learning: null,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/before', '/instructor/live-sessions/ses-1/processing']}
        initialIndex={1}
      >
        <Routes>
          <Route path="/before" element={<h1>이전 화면</h1>} />
          <Route path="/instructor/live-sessions/:sessionId/processing" element={<LiveSessionProcessingPage />} />
          <Route path="/instructor/lessons/:lessonId/replay" element={<ReplayDestination />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('녹화 처리 화면', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * 예전에는 READY + PUBLISHED에서 다시보기로 <b>자동 이동</b>했다. 그건 강의를 종료하면 여기로
   * 끌려와 대기하던 옛 동선을 위한 것이었고, [ADR-0092]가 그 자동 진입을 없앤 뒤로는 일부러 들어온
   * 사람을 쫓아내기만 했다 — 강의 상세의 배지를 눌러도 들어오자마자 튕겨 나갔다.
   *
   * <p>이제 머문다. 끝난 녹화의 단계 기록을 여기서 볼 수 있고, 영상으로는 <b>사용자가</b> 간다.
   */
  it('READY + PUBLISHED에서도 머물고, 조회는 한 번만 한다', async () => {
    renderPage(status('READY', 'PUBLISHED'))

    expect(await screen.findByRole('heading', { name: '녹화 처리 현황' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '다시보기 도착' })).not.toBeInTheDocument()
    // terminal 상태라 폴링이 붙지 않는다(ADR-0007).
    expect(getProcessingStatus).toHaveBeenCalledTimes(1)
    expect(getProcessingStatus).toHaveBeenCalledWith('ses-1')

    // 공개까지 끝났어도 영상으로 갈 길은 열어 둔다.
    expect(screen.getByRole('link', { name: 'VOD 미리보기·검수' })).toHaveAttribute(
      'href',
      '/instructor/lessons/les-1/replay',
    )
  })

  it('READY + DRAFT에서는 자동 이동하지 않고 수동 게시 진입을 제공한다', async () => {
    renderPage(status('READY', 'DRAFT'))

    expect(await screen.findByRole('heading', { name: '녹화 처리 현황' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '다시보기 도착' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'VOD 미리보기·검수' })).toHaveAttribute(
      'href',
      '/instructor/lessons/les-1/replay',
    )
    expect(screen.getByRole('link', { name: '커리큘럼 관리' })).toHaveAttribute(
      'href',
      '/instructor/curriculums',
    )
  })

  it('FAILED에서는 failureCode를 표시하고 이동하지 않는다', async () => {
    renderPage(status('FAILED', 'DRAFT'))

    expect(await screen.findByText(/MANIFEST_MISSING/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '다시보기 도착' })).not.toBeInTheDocument()
  })
})
