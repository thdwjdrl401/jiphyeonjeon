import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMyWatchBuckets, reportWatchBuckets } from './liveSessionService'
import {
  advanceWatchBuckets,
  emptyWatchBucketState,
  markWatchBucketsSent,
  seedWatchBuckets,
  type WatchBucketState,
} from './watchBuckets'

/** 전송 주기. 짧으면 요청이 잦고, 길면 브라우저를 갑자기 닫았을 때 잃는 구간이 커진다. */
const FLUSH_INTERVAL_MS = 15_000

/**
 * 재생 위치를 따라 구간별 시청 횟수를 세고 주기적으로 보낸다(ADR-0063).
 *
 * <p><b>서버에 쌓인 내 누적으로 시작한다</b> — 새로고침 뒤 0부터 세면 그 회차가 사라진다.
 * 보내는 값은 누적 절대값이라 재전송이 횟수를 부풀리지 않는다.
 *
 * <p>페이지를 떠날 때도 한 번 보낸다. 마지막 주기 뒤에 본 구간이 그냥 사라지면, 강의 끝부분이
 * 늘 덜 본 것으로 남는다.
 */
export function useWatchTracking(lessonId: string, positionMs: number, enabled: boolean) {
  const stateRef = useRef<WatchBucketState>(emptyWatchBucketState)
  const seededRef = useRef(false)

  const mine = useQuery({
    queryKey: ['watch-buckets-mine', lessonId],
    queryFn: () => getMyWatchBuckets(lessonId),
    enabled: enabled && Boolean(lessonId),
  })

  useEffect(() => {
    if (!mine.data || seededRef.current) return
    seededRef.current = true
    stateRef.current = seedWatchBuckets(mine.data)
  }, [mine.data])

  // 위치가 흐르는 동안 칸을 센다. 칸이 바뀔 때만 늘어난다(같은 칸 안의 갱신은 무시).
  useEffect(() => {
    if (!enabled || !seededRef.current) return
    stateRef.current = advanceWatchBuckets(stateRef.current, positionMs)
  }, [enabled, positionMs])

  useEffect(() => {
    if (!enabled || !lessonId) return undefined

    const flush = () => {
      const state = stateRef.current
      if (!state.dirty) return   // 안 움직였으면 보내지 않는다
      stateRef.current = markWatchBucketsSent(state)
      // 실패해도 다음 주기에 같은 누적을 다시 보낸다 — 절대값이라 재전송이 안전하다.
      void reportWatchBuckets(lessonId, state.counts).catch(() => {
        stateRef.current = { ...stateRef.current, dirty: true }
      })
    }

    const timer = window.setInterval(flush, FLUSH_INTERVAL_MS)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      flush()   // 화면을 떠날 때 마지막 한 번
    }
  }, [enabled, lessonId])
}
