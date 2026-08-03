import { useMemo, useState } from 'react'
import type { WatchHeatmap } from './liveSessionService.interface'

/**
 * "많이 다시 본 구간" 띠(ADR-0063).
 *
 * <p>재생바 <b>안</b>이 아니라 바로 아래에 같은 폭으로 둔다. 플레이어는 vidstack 기본 레이아웃을
 * 쓰는데 DVR·duration 처리가 예민해(라이브 되감기가 duration에 걸려 있다) 레이아웃을 통째로
 * 커스텀하면 잃을 것이 크다. 띠는 붙이고 빼기가 쉽다.
 *
 * <p>값은 절대 횟수가 아니라 <b>도달한 사람 수로 나눈 강도</b>다 — 합만 그리면 뒤로 갈수록 이탈자가
 * 늘어 재시청과 무관하게 우하향이 된다.
 */
interface Props {
  heatmap: WatchHeatmap | null
  /** 전체 길이. 점 하나가 몇 초인지와 클릭 시 이동 위치를 계산한다. 모르면 이동을 막는다. */
  durationMs: number | null
  onSeek?: (sessionMs: number) => void
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export default function WatchHeatmapStrip({ heatmap, durationMs, onSeek }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)
  const points = useMemo(() => heatmap?.points ?? [], [heatmap])

  /*
   * 가장 높은 점을 1로 두고 나머지를 상대 높이로 그린다. 절대값(2.0 등)을 그대로 높이로 쓰면
   * 다들 한 번씩만 본 강의는 띠가 통째로 낮아 "아무도 안 봤다"처럼 보인다.
   */
  const max = useMemo(() => points.reduce((a, b) => Math.max(a, b), 0), [points])

  if (points.length === 0 || max <= 0) return null

  const spanMs = durationMs && durationMs > 0 ? durationMs / points.length : null

  return (
    <div aria-label="많이 다시 본 구간" className="watch-heatmap" role="group">
      <div className="watch-heatmap__bars">
        {points.map((value, index) => {
          const at = spanMs === null ? null : Math.round(index * spanMs)
          const label = at === null
            ? `${index + 1}번째 구간`
            : `${formatTime(at)} 구간`
          return (
            <button
              aria-label={`${label} · 평균 ${value.toFixed(1)}회 재생`}
              className={hovered === index ? 'is-hovered' : ''}
              disabled={at === null || !onSeek}
              key={index}
              style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
              type="button"
              onClick={() => at !== null && onSeek?.(at)}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
            />
          )
        })}
      </div>
      <p className="watch-heatmap__caption">
        {hovered !== null && spanMs !== null
          ? `${formatTime(Math.round(hovered * spanMs))} · 평균 ${points[hovered].toFixed(1)}회 재생`
          : `많이 다시 본 구간 · ${heatmap?.viewers ?? 0}명 기준`}
      </p>
    </div>
  )
}
