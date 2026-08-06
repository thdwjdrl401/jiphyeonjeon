import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BookmarkStrip from '@/features/live-session/BookmarkStrip'

function bookmark(sessionMs: number, bookmarkId = `bm-${sessionMs}`) {
  return { bookmarkId, sessionMs, createdAt: '2026-08-01T10:30:00+09:00' }
}

describe('내 북마크 스트립', () => {
  it('찍은 시각을 눌러 그 지점으로 돌아간다', async () => {
    const onSeek = vi.fn()
    render(<BookmarkStrip bookmarks={[bookmark(742_000)]} canSeek onDelete={vi.fn()} onSeek={onSeek} />)

    await userEvent.click(screen.getByRole('button', { name: '12:22' }))
    expect(onSeek).toHaveBeenCalledWith(742_000)
  })

  it('시간 순으로 정렬한다 — 찍은 순서가 아니라 강의 흐름대로 봐야 한다', () => {
    render(<BookmarkStrip bookmarks={[bookmark(742_000), bookmark(128_000)]} canSeek onDelete={vi.fn()} onSeek={vi.fn()} />)

    expect(screen.getAllByRole('button', { name: /^\d{2}:\d{2}$/ }).map((button) => button.textContent))
      .toEqual(['02:08', '12:22'])
  })

  it('종료된 라이브에서는 이동 버튼을 만들지 않는다', () => {
    render(<BookmarkStrip bookmarks={[bookmark(128_000)]} canSeek={false} onDelete={vi.fn()} onSeek={vi.fn()} />)

    // 누를 수 없는 버튼을 남기면 보조기술에는 여전히 이동 가능한 컨트롤로 읽힌다.
    expect(screen.queryByRole('button', { name: '02:08' })).not.toBeInTheDocument()
    expect(screen.getByText('02:08')).toBeInTheDocument()
  })

  it('북마크가 없으면 빈 줄을 남기지 않는다', () => {
    const { container } = render(<BookmarkStrip bookmarks={[]} canSeek onDelete={vi.fn()} onSeek={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('삭제 버튼으로 지우기 배지를 켜고 끌 수 있다', async () => {
    const onDelete = vi.fn()
    render(
      <BookmarkStrip
        bookmarks={[bookmark(128_000, 'b1'), bookmark(742_000, 'b2')]}
        canSeek
        onDelete={onDelete}
        onSeek={vi.fn()}
      />,
    )

    // 평소엔 카드에 지우기 배지가 없다.
    expect(screen.queryByRole('button', { name: '02:08 북마크 삭제' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '북마크 삭제' }))
    expect(screen.getByRole('button', { name: '삭제 완료' })).toBeInTheDocument()

    // 삭제 모드에서는 이동 버튼 대신 시각만 남는다 — 지우려다 실수로 이동하지 않게.
    expect(screen.queryByRole('button', { name: '02:08' })).not.toBeInTheDocument()
    expect(screen.getByText('02:08')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '02:08 북마크 삭제' }))
    expect(onDelete).toHaveBeenCalledWith('b1')

    // 다시 누르면 삭제 모드에서 빠져나오고, 이동 버튼이 되돌아온다.
    await userEvent.click(screen.getByRole('button', { name: '삭제 완료' }))
    expect(screen.getByRole('button', { name: '북마크 삭제' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '02:08 북마크 삭제' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '02:08' })).toBeInTheDocument()
  })

  it('넘치면 화살표가 뜨고, 눌러서 넘긴다', () => {
    const { container } = render(
      <BookmarkStrip
        bookmarks={[bookmark(1_000, 'b1'), bookmark(2_000, 'b2'), bookmark(3_000, 'b3')]}
        canSeek
        onDelete={vi.fn()}
        onSeek={vi.fn()}
      />,
    )
    const list = container.querySelector('.bookmark-strip__list') as HTMLUListElement

    // 처음엔 넘치지 않는 것으로 측정된다(jsdom 기본값 0/0) — 화살표가 없다.
    expect(screen.queryByRole('button', { name: '다음 북마크' })).not.toBeInTheDocument()

    Object.defineProperties(list, {
      scrollWidth: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    fireEvent.scroll(list)

    const next = screen.getByRole('button', { name: '다음 북마크' })
    const prev = screen.getByRole('button', { name: '이전 북마크' })
    expect(next).toBeEnabled()
    expect(prev).toBeDisabled()

    fireEvent.click(next)
    expect(list.scrollLeft).toBeGreaterThan(0)
  })
})
