import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessingStatus } from '@/features/live-session/liveSessionService.interface'
import LiveSessionProcessingPage from '@/pages/LiveSessionProcessingPage'

const getProcessingStatus = vi.fn()

vi.mock('@/features/live-session/liveSessionService', () => ({
  getLiveSession: vi.fn(async () => ({ sessionId: 'ses-1', lessonId: 'les-1', status: 'ENDED' })),
  getProcessingStatus: (sessionId: string) => getProcessingStatus(sessionId),
}))

vi.mock('@/features/lesson/lessonService', () => ({
  getLesson: vi.fn(async () => ({
    lessonId: 'les-1',
    sectionId: 'sec-1',
    curriculumId: 'cur-1',
    title: 'Spring Security 시작하기',
  })),
}))

function processing(overrides: Partial<ProcessingStatus['videoAsset']> | null): ProcessingStatus {
  return {
    sessionId: 'ses-1',
    liveSessionStatus: 'ENDED',
    recordingEnabled: true,
    startedAt: '2026-08-01T10:00:00+09:00',
    endedAt: '2026-08-01T11:32:00+09:00',
    videoAsset: overrides === null ? null : {
      videoAssetId: 'vid-1',
      status: 'READY',
      replayStatus: 'DRAFT',
      failureCode: null,
      durationMs: 5_520_000,
      sizeBytes: null,
      recordingStartedAt: null,
      recordingEndedAt: null,
      ...overrides,
    },
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/instructor/live-sessions/ses-1/processing']}>
        <Routes>
          <Route element={<LiveSessionProcessingPage />} path="/instructor/live-sessions/:sessionId/processing" />
          <Route element={<h1>다시보기 도착</h1>} path="/instructor/lessons/:lessonId/replay" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('종료 후 처리 현황 화면', () => {
  beforeEach(() => {
    getProcessingStatus.mockReset()
  })

  it('요약을 서버 값으로 채운다 — 강의 제목·녹화 길이·종료 시각이 하드코딩이 아니다', async () => {
    getProcessingStatus.mockResolvedValue(processing({}))
    renderPage()

    expect(await screen.findByText('Spring Security 시작하기')).toBeInTheDocument()
    expect(screen.getByText('1시간 32분')).toBeInTheDocument()
    // sessionId(UUID)를 강의 이름 자리에 넣지 않는다.
    expect(screen.queryByText('ses-1')).not.toBeInTheDocument()
  })

  it('자산이 READY여도 게시 전이면 "공개하지 않았다"고 말한다 — 준비와 게시는 다른 축이다', async () => {
    getProcessingStatus.mockResolvedValue(processing({ status: 'READY', replayStatus: 'DRAFT' }))
    renderPage()

    expect(await screen.findByText(/아직 수강생에게 공개하지 않았습니다/)).toBeInTheDocument()
  })

  it('게시까지 끝나면 다시보기로 자동 이동한다', async () => {
    getProcessingStatus.mockResolvedValue(processing({ status: 'READY', replayStatus: 'PUBLISHED' }))
    renderPage()

    expect(await screen.findByRole('heading', { name: '다시보기 도착' })).toBeInTheDocument()
  })

  it('READY 전에는 검수로 가는 링크를 만들지 않는다', async () => {
    getProcessingStatus.mockResolvedValue(processing({ status: 'FINALIZING' }))
    renderPage()

    // 문구는 남되 링크가 아니어야 한다 — to="#"는 현재 경로로 풀려 "잠긴 링크"가 실제로는 이동한다.
    expect(await screen.findByText('VOD 미리보기·검수')).toHaveAttribute('aria-disabled')
    expect(screen.queryByRole('link', { name: 'VOD 미리보기·검수' })).not.toBeInTheDocument()
  })

  it('READY가 되면 검수 링크가 열린다', async () => {
    getProcessingStatus.mockResolvedValue(processing({ status: 'READY' }))
    renderPage()

    expect(await screen.findByRole('link', { name: 'VOD 미리보기·검수' }))
      .toHaveAttribute('href', expect.stringContaining('les-1'))
  })

  it('실패하면 이유 코드를 보여준다 — 재시도 가능 여부를 강사가 판단해야 한다', async () => {
    getProcessingStatus.mockResolvedValue(processing({ status: 'FAILED', failureCode: 'EGRESS_FAILED' }))
    renderPage()

    expect(await screen.findByText(/EGRESS_FAILED/)).toBeInTheDocument()
  })

  it('자산이 없는 것을 실패로 표시하지 않는다', async () => {
    getProcessingStatus.mockResolvedValue(processing(null))
    renderPage()

    expect(await screen.findByText(/아직 녹화 자산이 만들어지지 않았습니다/)).toBeInTheDocument()
  })

  it('녹화를 끄고 진행한 세션은 그 사실을 말한다', async () => {
    getProcessingStatus.mockResolvedValue({ ...processing(null), recordingEnabled: false })
    renderPage()

    expect(await screen.findByText(/녹화를 켜지 않고 진행해/)).toBeInTheDocument()
  })
})
