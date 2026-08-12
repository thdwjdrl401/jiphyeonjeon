import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as adminService from '@/features/admin/adminService'
import AdminSessionDetailPage from '@/pages/admin/AdminSessionDetailPage'

/**
 * 운영 콘솔의 "지금 누가 보고 있는가"(ADR-0121).
 *
 * <p>콘솔은 Egress와 LiveKit만 볼 수 있었다. 둘 다 <b>기계</b>의 상태라, 강사가 혼자 말하고 있는
 * 세션과 30명이 듣는 세션이 화면에서 똑같이 보였다.
 *
 * <p>여기서 지키는 것은 <b>두 목록이 섞이지 않는 것</b>과 <b>이 조회 하나가 화면을 못 쓰게 만들지
 * 않는 것</b>이다. 라이브 접속자와 다시보기 시청자는 다른 것을 말하고, 접속 현황은 부가 정보라
 * 실패해도 녹화·Egress 판단은 그대로 돼야 한다.
 */
vi.mock('@/features/admin/adminService', async () => {
  const actual = await vi.importActual<typeof adminService>('@/features/admin/adminService')
  return {
    ...actual,
    getSessionDetail: vi.fn(),
    getActiveEgresses: vi.fn(),
    getSessionViewers: vi.fn(),
  }
})

const getSessionDetail = vi.mocked(adminService.getSessionDetail)
const getActiveEgresses = vi.mocked(adminService.getActiveEgresses)
const getSessionViewers = vi.mocked(adminService.getSessionViewers)

const SESSION_ID = '11111111-1111-1111-1111-111111111111'

function detail(status: string): adminService.SessionDetail {
  return {
    sessionId: SESSION_ID,
    roomName: `session-${SESSION_ID}`,
    status,
    roomSid: 'RM_x',
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    features: { recording: true, caption: true, chat: true, aiQna: true },
    lessonId: '22222222-2222-2222-2222-222222222222',
    lessonTitle: '3주차 — 트리 순회',
    curriculumId: '33333333-3333-3333-3333-333333333333',
    curriculumTitle: '자료구조 심화',
    instructorId: '44444444-4444-4444-4444-444444444444',
    instructorName: '김강사',
    recording: null,
  }
}

function viewers(over: Partial<adminService.SessionViewers> = {}): adminService.SessionViewers {
  return { sessionId: SESSION_ID, live: [], replay: [], recentWindowSeconds: 60, ...over }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/live-sessions/${SESSION_ID}`]}>
        <Routes>
          <Route path="/admin/live-sessions/:sessionId" element={<AdminSessionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('운영 콘솔 세션 상세 — 접속 현황', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionDetail.mockResolvedValue(detail('LIVE'))
    getActiveEgresses.mockResolvedValue([])
  })

  it('라이브 접속자와 다시보기 시청자를 나눠 보여준다', async () => {
    getSessionViewers.mockResolvedValue(viewers({
      live: [
        { userId: 'u-1', displayName: '김강사', instructor: true, since: new Date().toISOString() },
        { userId: 'u-2', displayName: '박수강', instructor: false, since: new Date().toISOString() },
      ],
      replay: [{
        userId: 'u-3',
        displayName: '이복습',
        lastPositionMs: 754_000,
        progressPercent: 42,
        lastReportedAt: new Date().toISOString(),
      }],
    }))

    renderPage()

    // 청중 수는 강사를 빼고 센다 — 강사가 포함되면 혼자일 때 1명이 되어 오해를 만든다.
    expect(await screen.findByRole('heading', { name: '라이브 강의실 1명' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '다시보기 1명' })).toBeInTheDocument()
    expect(screen.getByText('박수강')).toBeInTheDocument()
    // 표의 구분 칸으로 찾는다 — 세션 패널에도 "강사" 항목이 따로 있다.
    expect(screen.getByRole('cell', { name: '강사' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '수강생' })).toBeInTheDocument()

    // 다시보기는 "어디를 보고 있는가"까지 말해야 쓸모가 있다.
    expect(screen.getByText('이복습')).toBeInTheDocument()
    expect(screen.getByText('12:34')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  /** 수강생은 기다리는데 화면에는 "진행 중"으로만 보이던 경우다. 정상과 구분되지 않았다. */
  it('진행 중인데 강사가 없으면 그렇게 말한다', async () => {
    getSessionViewers.mockResolvedValue(viewers({
      live: [
        { userId: 'u-2', displayName: '박수강', instructor: false, since: new Date().toISOString() },
      ],
    }))

    renderPage()

    expect(await screen.findByText(/강사가 강의실에 없습니다/)).toBeInTheDocument()
    expect(screen.getByText(/수강생 1명이 들어와 있습니다/)).toBeInTheDocument()
  })

  it('강사가 들어와 있으면 경고하지 않는다', async () => {
    getSessionViewers.mockResolvedValue(viewers({
      live: [
        { userId: 'u-1', displayName: '김강사', instructor: true, since: new Date().toISOString() },
      ],
    }))

    renderPage()

    expect(await screen.findByRole('heading', { name: /라이브 강의실/ })).toBeInTheDocument()
    expect(screen.queryByText(/강사가 강의실에 없습니다/)).not.toBeInTheDocument()
  })

  /** 이름 하나 때문에 인원이 틀리면 안 된다 — 탈퇴한 사용자도 듣고 있으면 한 명이다. */
  it('이름을 못 찾은 사람도 행으로 남는다', async () => {
    getSessionViewers.mockResolvedValue(viewers({
      live: [
        { userId: 'u-9', displayName: null, instructor: false, since: new Date().toISOString() },
      ],
    }))

    renderPage()

    expect(await screen.findByText('이름을 찾을 수 없음')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '라이브 강의실 1명' })).toBeInTheDocument()
  })

  /** 접속 현황은 부가 정보다. 이것 하나가 실패해도 녹화·Egress 판단은 그대로 돼야 한다. */
  it('접속 현황을 못 불러와도 세션 상세는 그대로 보인다', async () => {
    getSessionViewers.mockRejectedValue(new Error('boom'))

    renderPage()

    expect(await screen.findByText('접속 현황을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(screen.getByText(`session-${SESSION_ID}`)).toBeInTheDocument()
    expect(screen.getByText('김강사')).toBeInTheDocument()
  })

  /** 일시정지·창 닫기로 보고가 끊기면 목록에서 빠진다. 화면이 그 이유를 말해야 "0명"이 읽힌다. */
  it('아무도 없으면 왜 비었는지 설명한다', async () => {
    getSessionViewers.mockResolvedValue(viewers())

    renderPage()

    expect(await screen.findByText('지금 강의실을 열어 둔 사람이 없습니다.')).toBeInTheDocument()
    expect(screen.getByText(/최근 60초 안에 다시보기를 재생한 사람이 없습니다/)).toBeInTheDocument()
  })
})
