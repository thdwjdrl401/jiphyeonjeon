import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CaptionDock from '@/features/live-session/CaptionDock'
import type { CaptionView } from '@/features/live-session/liveSessionService'

const caption: CaptionView = {
  segmentId: 'caption-1',
  startMs: 728_000,
  endMs: 732_000,
  at: '12:08',
  text: '종료 직전 자막입니다.',
  termReferences: [],
  synced: true,
}

describe('실시간 자막 시각 이동 게이트', () => {
  it('ENDING까지는 시각 버튼으로 이동할 수 있다', () => {
    const onSeek = vi.fn()
    render(
      <CaptionDock
        captions={[caption]}
        currentSessionMs={728_000}
        label="실시간 자막"
        onSeek={onSeek}
        onSelectTerm={() => {}}
        canSeek
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '12:08' }))
    expect(onSeek).toHaveBeenCalledOnce()
  })

  it('ENDED에서는 시각을 time으로 표시하고 이동을 만들지 않는다', () => {
    const onSeek = vi.fn()
    render(
      <CaptionDock
        captions={[caption]}
        currentSessionMs={728_000}
        label="실시간 자막"
        onSeek={onSeek}
        onSelectTerm={() => {}}
        canSeek={false}
      />,
    )

    expect(screen.queryByRole('button', { name: '12:08' })).not.toBeInTheDocument()
    expect(screen.getByText('12:08').tagName).toBe('TIME')
    expect(onSeek).not.toHaveBeenCalled()
  })
})
