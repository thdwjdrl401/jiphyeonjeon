import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BookmarkStrip from '@/features/live-session/BookmarkStrip'

function bookmark(sessionMs: number) {
  return { sessionMs, createdAt: '2026-08-01T10:30:00+09:00' }
}

describe('내 북마크 스트립', () => {
  it('찍은 시각을 눌러 그 지점으로 돌아간다', async () => {
    const onSeek = vi.fn()
    render(<BookmarkStrip bookmarks={[bookmark(742_000)]} canSeek onSeek={onSeek} />)

    await userEvent.click(screen.getByRole('button', { name: '12:22' }))
    expect(onSeek).toHaveBeenCalledWith(742_000)
  })

  it('시간 순으로 정렬한다 — 찍은 순서가 아니라 강의 흐름대로 봐야 한다', () => {
    render(<BookmarkStrip bookmarks={[bookmark(742_000), bookmark(128_000)]} canSeek onSeek={vi.fn()} />)

    expect(screen.getAllByRole('button').map((button) => button.textContent))
      .toEqual(['02:08', '12:22'])
  })

  it('종료된 라이브에서는 이동 버튼을 만들지 않는다', () => {
    render(<BookmarkStrip bookmarks={[bookmark(128_000)]} canSeek={false} onSeek={vi.fn()} />)

    // 누를 수 없는 버튼을 남기면 보조기술에는 여전히 이동 가능한 컨트롤로 읽힌다.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('02:08')).toBeInTheDocument()
  })

  it('북마크가 없으면 빈 줄을 남기지 않는다', () => {
    const { container } = render(<BookmarkStrip bookmarks={[]} canSeek onSeek={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
