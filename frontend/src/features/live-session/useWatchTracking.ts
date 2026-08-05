import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { updateProgress } from '@/features/learning/learningService'
import { getMyWatchBuckets, reportWatchBuckets } from './liveSessionService'
import {
  advanceWatchBuckets,
  bucketProgressPercent,
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
 *
 * <p><b>같은 주기에 진도도 보낸다</b>(ADR-0033·0063). 진도율은 이 칸 데이터에서 파생되는 값이라
 * (본 칸 ÷ 전체 칸) 따로 셀 것도, 타이머를 하나 더 둘 것도 없다. 강의 길이를 모르면
 * ({@code durationMs}가 null — 진행 중인 라이브) 칸만 보내고 진도는 건너뛴다. 전체 칸 수를
 * 모르는 채로 낸 비율은 아무 뜻이 없다.
 *
 * @param durationMs 강의 전체 길이. 모르면 null — 진도는 보내지 않는다.
 */
export function useWatchTracking(
  lessonId: string,
  positionMs: number,
  enabled: boolean,
  durationMs: number | null = null,
) {
  const stateRef = useRef<WatchBucketState>(emptyWatchBucketState)
  const seededRef = useRef(false)
  // flush 클로저는 [enabled, lessonId]에만 매여 있다. 최신 위치·길이는 ref로 읽는다.
  const positionRef = useRef(positionMs)
  const durationRef = useRef(durationMs)
  positionRef.current = positionMs
  durationRef.current = durationMs

  const mine = useQuery({
    queryKey: ['watch-buckets-mine', lessonId],
    queryFn: () => getMyWatchBuckets(lessonId),
    enabled: enabled && Boolean(lessonId),
  })

  useEffect(() => {
    if (!mine.data || seededRef.current) return
    seededRef.current = true
    /*
     * seed 직후 <b>지금 있는 칸부터</b> 센다. 아래 효과는 위치가 바뀔 때만 도는데, seed를 기다리는
     * 동안 위치가 그대로였으면 다시 돌지 않아 그 칸이 통째로 빠진다 — 0:00에서 시작하는 재생에서는
     * 늘 첫 칸이었다. 한 칸이 비면 끝까지 봐도 진도가 100%에 닿지 않는다.
     */
    stateRef.current = advanceWatchBuckets(seedWatchBuckets(mine.data), positionRef.current)
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
      /*
       * 진도가 실패해도 <b>칸 보고를 되돌리지 않는다.</b> 둘은 다른 엔드포인트이고, 진도 때문에
       * 칸을 다시 보내면 재시청 횟수만 부풀 뿐 진도가 살아나지 않는다. 진도는 다음 주기에 더 큰
       * 값으로 다시 나간다 — 본 칸 수는 줄지 않으므로 한 번 놓쳐도 따라잡는다.
       */
      const percent = bucketProgressPercent(state, durationRef.current)
      if (percent === null) return
      void updateProgress(lessonId, {
        progressPercent: percent,
        lastPositionMs: Math.max(0, Math.round(positionRef.current)),
        clientUpdatedAt: new Date().toISOString(),
      }).catch(() => {})
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
