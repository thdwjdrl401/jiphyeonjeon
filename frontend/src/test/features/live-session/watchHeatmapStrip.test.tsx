import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import WatchHeatmapStrip from '@/features/live-session/WatchHeatmapStrip'

const heatmap = { bucketSizeMs: 10_000, points: [1, 1, 2, 1], viewers: 5 }

describe('많이 다시 본 구간 띠', () => {
  it('가장 높은 점을 기준으로 상대 높이를 그린다', () => {
    render(<WatchHeatmapStrip durationMs={40_000} heatmap={heatmap} onSeek={vi.fn()} />)

    const bars = screen.getAllByRole('button')
    expect(bars).toHaveLength(4)
    // 2.0이 최댓값이라 100%, 1.0은 그 절반이다.
    expect(bars[2]).toHaveStyle({ height: '100%' })
    expect(bars[0]).toHaveStyle({ height: '50%' })
  })

  it('누르면 그 구간으로 보낸다', async () => {
    const onSeek = vi.fn()
    render(<WatchHeatmapStrip durationMs={40_000} heatmap={heatmap} onSeek={onSeek} />)

    // 40초를 4점으로 나눴으니 3번째 점은 20초 지점이다.
    await userEvent.click(screen.getAllByRole('button')[2])
    expect(onSeek).toHaveBeenCalledWith(20_000)
  })

  it('전체 길이를 모르면 이동을 막는다 — 엉뚱한 지점으로 보내면 안 된다', () => {
    render(<WatchHeatmapStrip durationMs={null} heatmap={heatmap} onSeek={vi.fn()} />)

    expect(screen.getAllByRole('button')[0]).toBeDisabled()
  })

  it('기록이 없으면 빈 띠를 남기지 않는다', () => {
    const { container } = render(
      <WatchHeatmapStrip durationMs={40_000} heatmap={{ bucketSizeMs: 10_000, points: [], viewers: 0 }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('아무도 다시 보지 않았으면(전부 0) 그리지 않는다', () => {
    const { container } = render(
      <WatchHeatmapStrip durationMs={40_000} heatmap={{ bucketSizeMs: 10_000, points: [0, 0], viewers: 0 }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
