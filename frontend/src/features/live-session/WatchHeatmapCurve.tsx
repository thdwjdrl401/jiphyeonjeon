import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WatchHeatmap } from './liveSessionService.interface'

/**
 * "많이 다시 본 구간" 곡선(ADR-0063).
 *
 * <p><b>재생바 위에 얹는다.</b> 예전에는 플레이어 <i>아래</i> 별도 띠였는데, 그러면 그래프의 x축과
 * 재생바의 x축이 눈으로만 이어져 "어느 지점이 높은가"를 읽으려면 두 막대를 번갈아 봐야 했다.
 * 유튜브가 재생바 바로 위에 그리는 이유가 이것이다 — 같은 축이면 한 번에 읽힌다.
 *
 * <p><b>플레이어 레이아웃은 건드리지 않는다.</b> vidstack의 DefaultVideoLayout은 DVR·duration
 * 처리가 예민해서(라이브 되감기가 duration에 걸려 있다) 통째로 커스텀하면 잃을 것이 크다. 대신
 * 레이아웃이 만든 <code>.vds-time-slider</code>를 찾아 그 안에 포털로 SVG 한 장만 넣는다.
 * 슬라이더가 리렌더되어도 우리 노드는 React가 관리하므로 살아남는다.
 *
 * <p><b>막대가 아니라 곡선인 이유.</b> 값은 10초 칸의 <i>평균 재생 횟수</i>다 — 칸 경계에서 뚝
 * 끊기는 양이 아니라 완만하게 변하는 양이고, 각진 막대는 없는 경계를 있는 것처럼 보이게 한다.
 * 점 사이를 Catmull-Rom으로 이어 부드러운 곡선 하나로 그린다.
 *
 * <p>값은 절대 횟수가 아니라 <b>도달한 사람 수로 나눈 강도</b>다 — 합만 그리면 뒤로 갈수록 이탈자가
 * 늘어 재시청과 무관하게 우하향이 된다.
 */
interface Props {
  heatmap: WatchHeatmap | null
  /** 그래프를 얹을 플레이어 루트. 이 안에서 vidstack의 재생바를 찾는다. */
  playerRoot: HTMLElement | null
}

/** SVG 좌표계. 실제 크기는 CSS가 정하므로 값 자체는 비율일 뿐이다. */
const VIEW_WIDTH = 1000
const VIEW_HEIGHT = 100

/**
 * 점들을 지나는 부드러운 경로.
 *
 * <p>Catmull-Rom 스플라인을 3차 베지어로 옮긴다. 스플라인이 <b>모든 점을 지나므로</b> 실제 값이
 * 왜곡되지 않는다(근사 곡선을 쓰면 최고점이 실제보다 낮게 그려져 "여기가 제일 어려웠다"가 흐려진다).
 */
export function smoothPath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const max = values.reduce((a, b) => Math.max(a, b), 0)
  if (max <= 0) return ''

  const step = values.length > 1 ? width / (values.length - 1) : width
  // 바닥에 붙은 구간도 선이 보이게 아주 얇게 띄운다.
  const point = (index: number): [number, number] => {
    const clamped = Math.min(values.length - 1, Math.max(0, index))
    return [clamped * step, height - Math.max(1, (values[clamped] / max) * height)]
  }

  let path = `M ${point(0)[0]} ${point(0)[1]}`
  for (let i = 0; i < values.length - 1; i += 1) {
    const [x0, y0] = point(i - 1)
    const [x1, y1] = point(i)
    const [x2, y2] = point(i + 1)
    const [x3, y3] = point(i + 2)
    // Catmull-Rom(장력 1/6) → 베지어 제어점.
    const c1x = x1 + (x2 - x0) / 6
    const c1y = y1 + (y2 - y0) / 6
    const c2x = x2 - (x3 - x1) / 6
    const c2y = y2 - (y3 - y1) / 6
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }
  return path
}

/**
 * vidstack이 재생바를 붙일 때까지 기다렸다가 그 노드를 돌려준다.
 *
 * <p>플레이어는 지연 로드되고 레이아웃도 비동기로 붙으므로, 마운트 시점에 한 번 찾는 것으로는
 * 거의 항상 놓친다. 붙는 순간을 MutationObserver로 잡는다.
 */
function useTimeSlider(playerRoot: HTMLElement | null) {
  const [slider, setSlider] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!playerRoot) {
      setSlider(null)
      return undefined
    }
    const find = () => playerRoot.querySelector<HTMLElement>('.vds-time-slider')
    const found = find()
    if (found) {
      setSlider(found)
      return undefined
    }
    const observer = new MutationObserver(() => {
      const el = find()
      if (el) {
        setSlider(el)
        observer.disconnect()
      }
    })
    observer.observe(playerRoot, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [playerRoot])
  return slider
}

export default function WatchHeatmapCurve({ heatmap, playerRoot }: Props) {
  const slider = useTimeSlider(playerRoot)
  const points = useMemo(() => heatmap?.points ?? [], [heatmap])
  const path = useMemo(() => smoothPath(points, VIEW_WIDTH, VIEW_HEIGHT), [points])

  // 기록이 없으면 아무것도 얹지 않는다. 바닥에 깔린 빈 곡선은 "아무도 안 봤다"로 읽힌다.
  if (!slider || !path) return null

  return createPortal(
    <div className="watch-curve" aria-hidden="true">
      <svg preserveAspectRatio="none" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
        {/* 면은 곡선 아래를 채운다 — 선만 있으면 재생바 위 어두운 화면에서 잘 안 보인다. */}
        <path className="watch-curve__area" d={`${path} L ${VIEW_WIDTH} ${VIEW_HEIGHT} L 0 ${VIEW_HEIGHT} Z`} />
        <path className="watch-curve__line" d={path} />
      </svg>
    </div>,
    slider,
  )
}
