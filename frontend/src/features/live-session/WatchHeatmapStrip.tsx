import { useMemo, useState } from 'react'
import type { WatchHeatmap } from './liveSessionService.interface'

/**
 * "많이 다시 본 구간" 띠(ADR-0063).
 *
 * <p><b>보여주기만 한다.</b> 바로 위에 재생바가 있으므로 이동은 그쪽이 한다 — 띠에도 이동을 달면
 * 같은 일을 두 곳에서 하게 되고, 막대 하나가 몇 초인지 알아야 해서 전체 길이에 묶인다(라이브는
 * 길이를 모른다). 읽는 것만 하면 길이 없이도 그릴 수 있다.
 *
 * <p>재생바 <b>안</b>이 아니라 아래에 두는 이유: 플레이어는 vidstack 기본 레이아웃을 쓰는데
 * DVR·duration 처리가 예민해(라이브 되감기가 duration에 걸려 있다) 레이아웃을 통째로 커스텀하면
 * 잃을 것이 크다.
 *
 * <p>값은 절대 횟수가 아니라 <b>도달한 사람 수로 나눈 강도</b>다 — 합만 그리면 뒤로 갈수록 이탈자가
 * 늘어 재시청과 무관하게 우하향이 된다.
 */
interface Props {
  heatmap: WatchHeatmap | null
  /** 전체 길이. 있으면 호버 문구에 시각을 적는다. 없어도(라이브 진행 중) 그래프는 그린다. */
  durationMs: number | null
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export default function WatchHeatmapStrip({ heatmap, durationMs }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)
  const points = useMemo(() => heatmap?.points ?? [], [heatmap])

  /*
   * 가장 높은 점을 100%로 두고 나머지를 상대 높이로 그린다. 절대값(2.0 등)을 그대로 높이로 쓰면
   * 다들 한 번씩만 본 강의는 띠가 통째로 낮아 "아무도 안 봤다"처럼 보인다.
   */
  const max = useMemo(() => points.reduce((a, b) => Math.max(a, b), 0), [points])

  if (points.length === 0 || max <= 0) return null

  const spanMs = durationMs && durationMs > 0 ? durationMs / points.length : null
  const hoveredAt = hovered !== null && spanMs !== null ? Math.round(hovered * spanMs) : null

  return (
    <div aria-label="많이 다시 본 구간" className="watch-heatmap" role="img">
      <div className="watch-heatmap__bars" aria-hidden="true">
        {points.map((value, index) => (
          <span
            className={hovered === index ? 'is-hovered' : ''}
            key={index}
            style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
          />
        ))}
      </div>
      <p className="watch-heatmap__caption">
        {hovered !== null
          ? `${hoveredAt === null ? `${hovered + 1}번째 구간` : formatTime(hoveredAt)} · 평균 ${points[hovered].toFixed(1)}회 재생`
          : `많이 다시 본 구간 · ${heatmap?.viewers ?? 0}명 기준`}
      </p>
    </div>
  )
}
