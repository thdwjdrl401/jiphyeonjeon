import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WatchHeatmapCurve from '@/features/live-session/WatchHeatmapCurve'
import type { WatchHeatmap } from '@/features/live-session/liveSessionService'

/**
 * 곡선이 <b>재생바 안</b>에 들어가는가.
 *
 * 여기가 이 컴포넌트의 유일한 위험 지점이다 — vidstack이 슬라이더를 붙이는 시점을 놓치면
 * 그래프가 조용히 사라지고, 엉뚱한 곳에 붙으면 x축이 재생바와 어긋나 값이 거짓말을 한다.
 */
const heatmap: WatchHeatmap = { points: [1, 3, 2, 5, 1], viewers: 4, bucketSizeMs: 10_000 }

function playerWithSlider() {
  const root = document.createElement('div')
  const slider = document.createElement('div')
  slider.className = 'vds-time-slider'
  root.appendChild(slider)
  document.body.appendChild(root)
  return { root, slider }
}

describe('WatchHeatmapCurve', () => {
  it('재생바 안에 곡선을 넣는다', async () => {
    const { root, slider } = playerWithSlider()
    render(<WatchHeatmapCurve heatmap={heatmap} playerRoot={root} />)

    await waitFor(() => expect(slider.querySelector('.watch-curve')).not.toBeNull())
    expect(slider.querySelector('path.watch-curve__line')?.getAttribute('d')).toContain('C ')
  })

  it('재생바가 나중에 붙어도 찾아 들어간다', async () => {
    // 플레이어는 지연 로드되고 레이아웃도 비동기로 붙는다. 마운트 때 한 번 찾는 것으로는 늘 놓친다.
    const root = document.createElement('div')
    document.body.appendChild(root)
    render(<WatchHeatmapCurve heatmap={heatmap} playerRoot={root} />)
    expect(root.querySelector('.watch-curve')).toBeNull()

    const slider = document.createElement('div')
    slider.className = 'vds-time-slider'
    root.appendChild(slider)

    await waitFor(() => expect(slider.querySelector('.watch-curve')).not.toBeNull())
  })

  it('기록이 없으면 아무것도 얹지 않는다', async () => {
    // 바닥에 깔린 빈 곡선은 "아무도 안 봤다"로 읽힌다.
    const { root, slider } = playerWithSlider()
    render(<WatchHeatmapCurve heatmap={{ points: [], viewers: 0, bucketSizeMs: 10_000 }} playerRoot={root} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(slider.querySelector('.watch-curve')).toBeNull()
  })

  it('플레이어가 아직 없으면 조용히 아무것도 하지 않는다', () => {
    const { container } = render(<WatchHeatmapCurve heatmap={heatmap} playerRoot={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('읽기 전용이다 — 이동은 재생바가 한다', async () => {
    // 띠에도 이동을 달면 같은 일을 두 곳에서 하게 되고, 막대 하나가 몇 초인지 알아야 해서
    // 전체 길이에 묶인다(라이브는 길이를 모른다).
    const { root, slider } = playerWithSlider()
    render(<WatchHeatmapCurve heatmap={heatmap} playerRoot={root} />)

    await waitFor(() => expect(slider.querySelector('.watch-curve')).not.toBeNull())
    expect(slider.querySelector('button')).toBeNull()
    expect(slider.querySelector('.watch-curve')?.getAttribute('aria-hidden')).toBe('true')
  })
})
