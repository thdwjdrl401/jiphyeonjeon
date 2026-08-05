import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getMyWatchBuckets = vi.fn<(lessonId: string) => Promise<Record<number, number>>>()
const reportWatchBuckets = vi.fn<(lessonId: string, counts: Record<number, number>) => Promise<void>>()
vi.mock('@/features/live-session/liveSessionService', () => ({
  getMyWatchBuckets: (lessonId: string) => getMyWatchBuckets(lessonId),
  reportWatchBuckets: (lessonId: string, counts: Record<number, number>) =>
    reportWatchBuckets(lessonId, counts),
}))

const updateProgress = vi.fn<(lessonId: string, update: unknown) => Promise<void>>()
vi.mock('@/features/learning/learningService', () => ({
  updateProgress: (lessonId: string, update: unknown) => updateProgress(lessonId, update),
}))

import { useWatchTracking } from '@/features/live-session/useWatchTracking'

/**
 * 시청 구간 보고와 <b>학습 진도 전송</b>(ADR-0063·0033).
 *
 * <p>진도가 이 훅에 붙어 있는 이유는 진도율이 칸 데이터에서 파생되기 때문이다 — 본 칸 ÷ 전체 칸.
 * 예전에는 칸만 보내고 진도는 아무도 보내지 않아, 서버 엔드포인트와 화면이 양쪽 다 있는데도
 * <b>학생 진행률이 영원히 0%였다.</b> 그 연결이 다시 끊기면 여기서 걸린다.
 */

/** 10초 칸 3개를 지나가게 해 dirty 상태를 만든다. */
const POSITIONS = [0, 10_000, 20_000]

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** 위치를 흘려보낸 뒤 언마운트한다 — 언마운트 flush가 마지막 한 번을 보낸다. */
async function watchThenLeave(durationMs: number | null) {
  const view = renderHook(
    ({ positionMs }: { positionMs: number }) =>
      useWatchTracking('les-1', positionMs, true, durationMs),
    { wrapper, initialProps: { positionMs: 0 } },
  )
  // 서버 누적을 받아 seed가 끝나야 칸을 세기 시작한다.
  await waitFor(() => expect(getMyWatchBuckets).toHaveBeenCalled())
  for (const positionMs of POSITIONS) view.rerender({ positionMs })
  view.unmount()
  return view
}

describe('시청 구간·진도 전송', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMyWatchBuckets.mockResolvedValue({})
    reportWatchBuckets.mockResolvedValue(undefined)
    updateProgress.mockResolvedValue(undefined)
  })

  it('강의 길이를 알면 칸과 함께 진도를 보낸다', async () => {
    await watchThenLeave(100_000)

    await waitFor(() => expect(reportWatchBuckets).toHaveBeenCalled())
    expect(updateProgress).toHaveBeenCalledTimes(1)
    const [lessonId, update] = updateProgress.mock.calls[0]
    expect(lessonId).toBe('les-1')
    // 100초 = 칸 10개 중 3개를 봤다 → 30%. 재생 위치 비율(20%)이 아니다.
    expect(update).toMatchObject({ progressPercent: 30, lastPositionMs: 20_000 })
  })

  /**
   * 진행 중인 라이브는 전체 길이를 모른다. 그 상태에서 낸 비율은 "지금까지 나온 것 중 몇 %"라
   * 늘 100%에 가깝게 나와, 듣기만 해도 완료가 찍힌다.
   */
  it('강의 길이를 모르면 칸만 보내고 진도는 보내지 않는다', async () => {
    await watchThenLeave(null)

    await waitFor(() => expect(reportWatchBuckets).toHaveBeenCalled())
    expect(updateProgress).not.toHaveBeenCalled()
  })

  /**
   * 서버 누적을 받아오는 동안 위치가 그대로였으면, 칸을 세는 효과는 다시 돌지 않는다. 그래서
   * <b>seed 시점에 있던 칸</b>을 명시적으로 세지 않으면 그 칸이 통째로 빠진다 — 0:00에서 시작하는
   * 재생에서는 늘 첫 칸이었고, 한 칸이 비면 끝까지 봐도 진도가 100%에 닿지 않는다.
   */
  it('seed가 끝난 시점의 칸부터 센다', async () => {
    renderHook(() => useWatchTracking('les-1', 0, true, 100_000), { wrapper })

    await waitFor(() => {
      window.dispatchEvent(new Event('pagehide'))
      expect(reportWatchBuckets).toHaveBeenCalled()
    })
    expect(reportWatchBuckets.mock.calls[0][1]).toEqual({ 0: 1 })
  })

  /** 안 움직였으면 다시 보내지 않는다 — 누적 절대값이라 재전송이 안전할 뿐, 공짜는 아니다. */
  it('바뀐 것이 없으면 다음 flush에서 보내지 않는다', async () => {
    renderHook(() => useWatchTracking('les-1', 0, true, 100_000), { wrapper })

    await waitFor(() => {
      window.dispatchEvent(new Event('pagehide'))
      expect(reportWatchBuckets).toHaveBeenCalled()
    })
    window.dispatchEvent(new Event('pagehide'))

    expect(reportWatchBuckets).toHaveBeenCalledTimes(1)
    expect(updateProgress).toHaveBeenCalledTimes(1)
  })

  /**
   * 둘은 다른 엔드포인트다. 진도가 실패했다고 칸을 다시 보내면 <b>재시청 횟수만 부풀고</b>
   * 진도가 살아나지도 않는다. 진도는 다음 주기에 더 큰 값으로 다시 나간다.
   */
  it('진도 전송이 실패해도 칸 보고를 되돌리지 않는다', async () => {
    updateProgress.mockRejectedValue(new Error('500'))
    await watchThenLeave(100_000)

    await waitFor(() => expect(updateProgress).toHaveBeenCalled())
    expect(reportWatchBuckets).toHaveBeenCalledTimes(1)
  })

  /** 강사·비수강자는 서버가 403으로 막는다. 애초에 요청을 만들지 않는 것이 맞다. */
  it('꺼져 있으면 조회도 전송도 하지 않는다', async () => {
    const view = renderHook(() => useWatchTracking('les-1', 20_000, false, 100_000), { wrapper })
    view.unmount()

    expect(getMyWatchBuckets).not.toHaveBeenCalled()
    expect(reportWatchBuckets).not.toHaveBeenCalled()
    expect(updateProgress).not.toHaveBeenCalled()
  })
})
