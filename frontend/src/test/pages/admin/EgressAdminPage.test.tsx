import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as adminService from '@/features/admin/adminService'
import EgressAdminPage from '@/pages/admin/EgressAdminPage'
import { ToastProvider } from '@/shared/ui/Toast'

/**
 * 운영 콘솔의 정지 버튼은 <b>결말을 구분해 말해야 한다.</b>
 *
 * <p>전에는 서버가 204만 돌려주고 정지되지 않는 경우를 전부 502로 던져, 콘솔이 성격이 다른 둘을
 * 똑같이 "정지에 실패했습니다"로 보여 줬다 — 이미 끝나서 할 일이 없는 것과, 소유 노드가 사라져
 * 영영 안 되는 것이다. 앞의 것은 멀쩡한 조작에 빨간불을 띄우고, 뒤의 것은 운영자가 무엇을 해야
 * 하는지 알 수 없어 같은 버튼을 반복해 누르게 만든다(2026-08-05에 실제로 그랬다).
 */
vi.mock('@/features/admin/adminService', async () => {
  const actual = await vi.importActual<typeof adminService>('@/features/admin/adminService')
  return { ...actual, getActiveEgresses: vi.fn(), stopEgress: vi.fn(), purgeEgress: vi.fn() }
})

const getActiveEgresses = vi.mocked(adminService.getActiveEgresses)
const stopEgress = vi.mocked(adminService.stopEgress)
const purgeEgress = vi.mocked(adminService.purgeEgress)

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <EgressAdminPage />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

function activeRow(egressId: string) {
  return { egressId, roomName: 'session-1', state: 'EGRESS_ACTIVE', startedAtMs: 1_785_900_000_000 }
}

/** 목록이 그려지고 정지 버튼이 나타날 때까지 기다린 뒤 누른다. */
async function clickStop(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '정지' }))
}

describe('Egress 운영 콘솔 — 정지 결말', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveEgresses.mockResolvedValue([activeRow('EG_live')])
  })

  it('정지되면 정지했다고 알린다', async () => {
    stopEgress.mockResolvedValue({ outcome: 'STOPPED' })
    const user = userEvent.setup()
    renderPage()

    await clickStop(user)

    await waitFor(() => { expect(screen.getByText('Egress를 정지했습니다.')).toBeInTheDocument() })
  })

  /** 중복 정지는 정상적으로 일어난다 — 목록을 보고 누른 시점과 작업이 끝난 시점이 겹칠 수 있다. */
  it('이미 끝난 작업은 오류로 알리지 않는다', async () => {
    stopEgress.mockResolvedValue({ outcome: 'ALREADY_ENDED' })
    const user = userEvent.setup()
    renderPage()

    await clickStop(user)

    await waitFor(() => { expect(screen.getByText('이미 종료된 Egress였습니다.')).toBeInTheDocument() })
    expect(screen.queryByText(/실패/)).not.toBeInTheDocument()
  })

  /**
   * <b>이 케이스가 이 변경의 이유다.</b> 유령은 다시 눌러도 결과가 같으므로, 그 사실과 다음에 할 일을
   * 함께 알려야 운영자가 같은 버튼을 반복하지 않는다.
   */
  it('유령은 다시 눌러도 소용없다는 것과 할 일을 함께 알린다', async () => {
    stopEgress.mockResolvedValue({ outcome: 'ORPHANED' })
    const user = userEvent.setup()
    renderPage()

    await clickStop(user)

    const notice = await screen.findByText(/다시 눌러도 같으니/)
    expect(notice).toHaveTextContent('수동 정리가 필요합니다')
  })

  /**
   * 안내만으로는 부족하다 — 이 화면에서 걷을 수 없다면 <b>여기서 걷을 수단</b>이 있어야 한다.
   * LiveKit Redis는 EC2 로컬에만 열려 있어 앱이 직접 못 지우므로, 서버가 호스트의 회수 중계를 부른다.
   */
  it('유령이면 제거 버튼을 띄우고, 누르면 실제로 회수한다', async () => {
    getActiveEgresses.mockResolvedValue([activeRow('EG_ghost')])
    stopEgress.mockResolvedValue({ outcome: 'ORPHANED' })
    purgeEgress.mockResolvedValue({ purged: true, outcome: 'ORPHANED' })
    const user = userEvent.setup()
    renderPage()

    await clickStop(user)
    await user.click(await screen.findByRole('button', { name: '유령 1건 제거' }))

    await waitFor(() => { expect(purgeEgress).toHaveBeenCalledWith('EG_ghost') })
    expect(await screen.findByText(/제거 1건/)).toBeInTheDocument()
  })

  /**
   * 누르는 사이 상황이 바뀌어 유령이 아니게 됐다면 서버가 지우지 않고 purged=false로 돌려준다.
   * 그때 "제거했다"고 말하면 운영자가 사라졌다고 믿는다 — 사실대로 알린다.
   */
  it('유령이 아니게 된 것은 지우지 않았다고 알린다', async () => {
    getActiveEgresses.mockResolvedValue([activeRow('EG_ghost')])
    stopEgress.mockResolvedValue({ outcome: 'ORPHANED' })
    purgeEgress.mockResolvedValue({ purged: false, outcome: 'STOPPED' })
    const user = userEvent.setup()
    renderPage()

    await clickStop(user)
    await user.click(await screen.findByRole('button', { name: '유령 1건 제거' }))

    expect(await screen.findByText(/유령이 아니어서 보존 1건/)).toBeInTheDocument()
  })

  it('LiveKit과 통신하지 못하면 그때만 요청 실패로 알린다', async () => {
    stopEgress.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    renderPage()

    await clickStop(user)

    await waitFor(() => {
      expect(screen.getByText('LiveKit에 정지를 요청하지 못했습니다.')).toBeInTheDocument()
    })
  })
})

describe('Egress 운영 콘솔 — 전부 정지', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * 전에는 실패를 통째로 삼키고 언제나 "모두 정지 요청했습니다"라고 알렸다. 유령이 하나도 걷히지
   * 않아도 성공으로 보였다는 뜻이다 — 콘솔이 거짓 안심을 준 자리라 결과를 세어 보고한다.
   */
  it('걷히지 않은 것이 있으면 성공으로 뭉뚱그리지 않는다', async () => {
    getActiveEgresses.mockResolvedValue([activeRow('EG_a'), activeRow('EG_b')])
    stopEgress
      .mockResolvedValueOnce({ outcome: 'STOPPED' })
      .mockResolvedValueOnce({ outcome: 'ORPHANED' })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: '전부 정지' }))

    // 요약 한 줄로 확인한다 — "유령 1건"은 아래 제거 버튼에도 나오므로 부분 일치로는 중복된다.
    await waitFor(() => {
      expect(screen.getByText('정지 1건 · 유령 1건')).toBeInTheDocument()
    })
  })
})
