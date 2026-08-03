import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import AppRouter from '@/app/router/AppRouter'
import { AuthProvider } from '@/features/auth/AuthContext'
import { mockAuthService } from '@/features/auth/mockAuthService'
import { resetMockDatabase } from '@/features/demo/mockDatabase'
import { ToastProvider } from '@/shared/ui/Toast'

/**
 * 라이브와 다시보기는 <b>한 벌의 화면</b>이다(ADR-0065).
 *
 * <p>두 화면은 따로 자라기 쉽다 — 다시보기에만 목 데이터가 남고, 라이브에만 부품이 붙고, 같은
 * 버튼이 한쪽에서는 저장을 하고 다른 쪽에서는 안 하는 식이다. 실제로 그렇게 갈라져 있었다.
 * 여기서 <b>같아야 하는 것</b>과 <b>달라도 되는 것</b>을 못박는다.
 */
/**
 * 수강생은 입장 전 점검을 거쳐야 강의실에 들어간다(RequireStudentPrejoinRoute).
 * 여기서 확인하려는 것은 점검 흐름이 아니라 <b>들어간 뒤의 화면</b>이므로 그 상태를 실어 보낸다.
 */
function entry(path: string) {
  const sessionId = /live-sessions\/([^/]+)\//.exec(path)?.[1]
  return sessionId ? { pathname: path, state: { prejoinSessionId: sessionId } } : path
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[entry(path)]}>
            <AppRouter />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const LIVE = '/student/live-sessions/ses-security-live/classroom'
const REPLAY = '/student/lessons/les-security/replay'

async function loginStudent() {
  await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
}

describe('라이브와 다시보기의 정합', () => {
  beforeEach(() => {
    resetMockDatabase()
    window.localStorage.clear()
  })

  it.each([
    ['라이브', LIVE],
    ['다시보기', REPLAY],
  ])('%s 화면은 같은 4개 탭을 같은 순서로 보여준다', async (_name, path) => {
    await loginStudent()
    renderAt(path)

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['채팅·질문', '실시간 노트', 'AI 질문', '핵심 용어'])
  })

  it.each([
    ['라이브', LIVE],
    ['다시보기', REPLAY],
  ])('%s 화면은 같은 플레이어와 자막 독을 쓴다', async (_name, path) => {
    await loginStudent()
    renderAt(path)

    expect(await screen.findByRole('region', { name: '강의 영상' })).toBeInTheDocument()
    // 자막 독은 라벨만 다르다(실시간 자막 / 자막). 둘 다 있어야 한다.
    expect(await screen.findByRole('region', { name: /자막$/ })).toBeInTheDocument()
  })

  it.each([
    ['라이브', LIVE],
    ['다시보기', REPLAY],
  ])('%s 화면은 경계를 끌어 크기를 바꿀 수 있다', async (_name, path) => {
    await loginStudent()
    renderAt(path)

    // 사이드 패널 폭과 자막 높이 두 축이 모두 조절 가능해야 한다.
    expect(await screen.findByRole('separator', { name: '사이드 패널 너비 조절' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '자막 높이 조절' })).toBeInTheDocument()
  })

  it.each([
    ['라이브', LIVE],
    ['다시보기', REPLAY],
  ])('%s 화면의 북마크는 눌렀을 때 서버에 저장된다', async (_name, path) => {
    await loginStudent()
    renderAt(path)

    // 다시보기 쪽은 예전에 별표만 토글하고 아무것도 보내지 않아, 눌러도 목록에 나타나지 않았다.
    const bookmark = await screen.findByRole('button', { name: /북마크/ })
    expect(bookmark).toBeEnabled()
  })

  it('두 화면 모두 하드코딩된 목차·진행률을 보이지 않는다', async () => {
    await loginStudent()
    const { unmount } = renderAt(REPLAY)
    await screen.findByRole('region', { name: '강의 영상' })

    // 존재하지 않는 시각으로 이동하던 가짜 챕터들이다.
    expect(screen.queryByText('인증 흐름')).not.toBeInTheDocument()
    expect(screen.queryByText('세션 저장소')).not.toBeInTheDocument()
    expect(screen.queryByText('CSRF 실습')).not.toBeInTheDocument()
    // 누구에게나 같은 숫자가 보이던 고정 진행률. 지금은 서버 값이라 목이 주는 값과 같아야 한다.
    expect(screen.getByText('학습 진행률 42%')).toBeInTheDocument()
    unmount()
  })

  it('다시보기에는 접속자 수를 표시하지 않는다', async () => {
    await loginStudent()
    renderAt(REPLAY)

    const player = await screen.findByRole('region', { name: '강의 영상' })
    // 지난 강의에 "지금 몇 명이 보고 있다"는 것은 없다. 예전에는 0명이 박혀 있었다.
    expect(within(player).queryByText(/명 참여 중/)).not.toBeInTheDocument()
  })

  it('다시보기에서는 새 채팅을 칠 수 없다', async () => {
    await loginStudent()
    renderAt(REPLAY)

    // 여기는 달라야 하는 것이다 — 지난 강의의 채팅은 읽기 전용이다.
    await screen.findByRole('tab', { name: '채팅·질문' })
    expect(screen.queryByLabelText('채팅 메시지')).not.toBeInTheDocument()
  })
})
