import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import WatchHeatmapStrip from '@/features/live-session/WatchHeatmapStrip'

const heatmap = { bucketSizeMs: 10_000, points: [1, 1, 2, 1], viewers: 5 }

function bars(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.watch-heatmap__bars span'))
}

describe('많이 다시 본 구간 띠', () => {
  it('가장 높은 점을 기준으로 상대 높이를 그린다', () => {
    const { container } = render(<WatchHeatmapStrip durationMs={40_000} heatmap={heatmap} />)

    const drawn = bars(container)
    expect(drawn).toHaveLength(4)
    // 2.0이 최댓값이라 100%, 1.0은 그 절반이다.
    expect(drawn[2]).toHaveStyle({ height: '100%' })
    expect(drawn[0]).toHaveStyle({ height: '50%' })
  })

  it('이동 컨트롤을 만들지 않는다 — 바로 위 재생바가 할 일이다', () => {
    const { container } = render(<WatchHeatmapStrip durationMs={40_000} heatmap={heatmap} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('a')).toBeNull()
  })

  it('가리키면 그 구간의 시각과 평균 횟수를 알려준다', async () => {
    const { container } = render(<WatchHeatmapStrip durationMs={40_000} heatmap={heatmap} />)

    // 40초를 4점으로 나눴으니 3번째 점은 20초 지점이다.
    await userEvent.hover(bars(container)[2])
    expect(screen.getByText('00:20 · 평균 2.0회 재생')).toBeInTheDocument()
  })

  it('전체 길이를 몰라도 그린다 — 라이브는 길이를 모른다', async () => {
    const { container } = render(<WatchHeatmapStrip durationMs={null} heatmap={heatmap} />)

    expect(bars(container)).toHaveLength(4)
    await userEvent.hover(bars(container)[2])
    // 시각 대신 순서로 말한다. 없는 시각을 지어내지 않는다.
    expect(screen.getByText('3번째 구간 · 평균 2.0회 재생')).toBeInTheDocument()
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
