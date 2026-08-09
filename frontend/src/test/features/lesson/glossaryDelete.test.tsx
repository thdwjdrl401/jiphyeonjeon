import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GlossaryReviewModal from '@/features/lesson/GlossaryReviewModal'

/**
 * 강사가 주요 용어를 <b>내릴 수 있다</b>.
 *
 * <p>AI가 자료에서 뽑은 용어라도 내려간다 — 서버가 원본을 지우는 것이 아니라 지웠다는 사실을
 * 덮어쓰기 자리에 묘비로 남기기 때문이다(ADR-0111). 화면에서 보는 결과는 하나다: 목록에서 빠진다.
 */
const service = vi.hoisted(() => ({
  getGlossary: vi.fn(async () => ([
    { termId: 'SecurityContext', term: 'SecurityContext', definition: '인증 정보를 담는다', source: 'MATERIAL' },
    { termId: '필터 체인', term: '필터 체인', definition: '요청을 거른다', source: 'INSTRUCTOR' },
  ])),
  upsertGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(async () => {}),
}))
vi.mock('@/features/live-session/liveSessionService', () => service)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/ui/Toast', () => ({ useToast: () => toast }))

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GlossaryReviewModal lessonId="les-1" lessonTitle="Spring Security" onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('주요 용어 삭제', () => {
  it('AI가 뽑은 용어도 삭제할 수 있다', async () => {
    const user = userEvent.setup()
    open()
    const row = (await screen.findByText('SecurityContext')).closest('li')!

    await user.click(within(row).getByRole('button', { name: '삭제' }))

    expect(service.deleteGlossaryTerm).toHaveBeenCalledWith('les-1', 'SecurityContext')
  })

  it('지우면 목록에서 바로 빠진다', async () => {
    const user = userEvent.setup()
    open()
    const row = (await screen.findByText('필터 체인')).closest('li')!

    await user.click(within(row).getByRole('button', { name: '삭제' }))

    await waitFor(() => { expect(screen.queryByText('필터 체인')).toBeNull() })
    // 남은 용어까지 사라지면 목록을 통째로 날린 것이다.
    expect(screen.getByText('SecurityContext')).toBeInTheDocument()
  })

  /** 되돌릴 길(같은 이름으로 다시 등록)을 안내한다 — 그래서 확인 창을 두지 않는다. */
  it('되살릴 수 있다는 것을 알린다', async () => {
    const user = userEvent.setup()
    open()
    const row = (await screen.findByText('필터 체인')).closest('li')!

    await user.click(within(row).getByRole('button', { name: '삭제' }))

    await waitFor(() => { expect(toast.success).toHaveBeenCalled() })
    expect(toast.success.mock.calls[0][0]).toContain('다시 등록하면')
  })

  it('실패하면 목록을 건드리지 않고 알린다', async () => {
    service.deleteGlossaryTerm.mockRejectedValueOnce(new Error('서버 오류'))
    const user = userEvent.setup()
    open()
    const row = (await screen.findByText('필터 체인')).closest('li')!

    await user.click(within(row).getByRole('button', { name: '삭제' }))

    await waitFor(() => { expect(toast.error).toHaveBeenCalled() })
    expect(screen.getByText('필터 체인')).toBeInTheDocument()
  })
})
