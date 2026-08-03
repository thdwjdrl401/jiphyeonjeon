import { describe, expect, it } from 'vitest'
import { smoothPath } from '@/features/live-session/WatchHeatmapCurve'

/**
 * 재생바 위 재시청 곡선의 경로(ADR-0063).
 *
 * 지키려는 것은 <b>실제 값이 왜곡되지 않는 것</b>이다. 최고점이 실제보다 낮게 그려지면
 * "여기가 제일 어려웠다"는 신호가 흐려진다.
 */
describe('smoothPath', () => {
  it('기록이 없으면 경로가 없다', () => {
    // 바닥에 깔린 빈 곡선은 "아무도 안 봤다"로 읽힌다 — 아예 그리지 않는다.
    expect(smoothPath([], 1000, 100)).toBe('')
    expect(smoothPath([0, 0, 0], 1000, 100)).toBe('')
  })

  it('가장 높은 점이 꼭대기에 닿는다', () => {
    const path = smoothPath([1, 2, 1], 1000, 100)
    // 최댓값 2가 y=0(꼭대기)이어야 한다. 근사 곡선을 쓰면 여기서 값이 깎인다.
    expect(path).toContain(' 0')
    expect(path.startsWith('M 0 ')).toBe(true)
  })

  it('첫 점과 끝 점이 좌우 끝에 닿는다', () => {
    // 값이 모두 같으면 전부 최댓값이라 평평한 선이 된다(높이는 최댓값 대비 상대값이다).
    const path = smoothPath([1, 1, 1, 1], 1000, 100)
    expect(path.startsWith('M 0 0')).toBe(true)
    // 마지막 좌표가 폭 전체다 — 짧으면 그래프가 재생바보다 좁아 축이 어긋난다.
    expect(path.trimEnd().endsWith('1000.00 0.00')).toBe(true)
  })

  it('바닥값도 선이 보이게 최소 높이를 남긴다', () => {
    const path = smoothPath([0, 10], 1000, 100)
    // 0인 칸이 완전히 바닥(y=100)이면 곡선이 축과 겹쳐 사라진다.
    expect(path).not.toContain('100.00')
    expect(path.startsWith('M 0 99')).toBe(true)
  })

  it('점이 하나뿐이어도 경로를 만든다', () => {
    // 강의 시작 직후 칸이 하나뿐인 순간에 터지면 안 된다.
    expect(smoothPath([3], 1000, 100)).toBe('M 0 0')
  })

  it('모든 점을 지난다', () => {
    // Catmull-Rom은 보간 곡선이라 각 점이 베지어 구간의 끝점으로 그대로 나타난다.
    const path = smoothPath([1, 4, 2], 1000, 100)
    const endpoints = [...path.matchAll(/, ([\d.]+) ([\d.]+)(?= |$)/g)].map((m) => m[2])
    // 4가 최댓값 → y=0, 2 → y=50, 1 → y=75
    expect(endpoints).toEqual(['0.00', '50.00'])
  })
})
