import { describe, expect, it } from 'vitest'
import {
  advanceWatchBuckets,
  bucketProgressPercent,
  emptyWatchBucketState,
  markWatchBucketsSent,
  mergeWatchBuckets,
  seedWatchBuckets,
  type WatchBucketState,
} from '@/features/live-session/watchBuckets'

describe('구간별 시청 횟수 집계', () => {
  it('같은 칸 안에서 위치만 움직이면 다시 세지 않는다', () => {
    // 위치 갱신은 초당 여러 번 온다. 그때마다 세면 한 칸이 수십 번 재생된 것으로 잡힌다.
    let state = advanceWatchBuckets(emptyWatchBucketState, 1_000)
    state = advanceWatchBuckets(state, 3_000)
    state = advanceWatchBuckets(state, 9_999)

    expect(state.counts).toEqual({ 0: 1 })
  })

  it('칸이 바뀌면 그 칸을 센다', () => {
    let state = advanceWatchBuckets(emptyWatchBucketState, 1_000)
    state = advanceWatchBuckets(state, 11_000)
    state = advanceWatchBuckets(state, 21_000)

    expect(state.counts).toEqual({ 0: 1, 1: 1, 2: 1 })
  })

  it('되감아 돌아오면 다시 센다 — 그게 이 기능이 잡으려는 신호다', () => {
    let state = advanceWatchBuckets(emptyWatchBucketState, 1_000)
    state = advanceWatchBuckets(state, 11_000)
    state = advanceWatchBuckets(state, 1_000)   // 되감기
    state = advanceWatchBuckets(state, 11_000)

    expect(state.counts).toEqual({ 0: 2, 1: 2 })
  })

  it('서버에 쌓인 내 누적에서 이어 센다 — 새로고침으로 회차가 사라지면 안 된다', () => {
    let state = seedWatchBuckets({ 0: 3, 5: 1 })
    state = advanceWatchBuckets(state, 1_000)

    expect(state.counts[0]).toBe(4)
    expect(state.counts[5]).toBe(1)
  })

  it('보낼 것이 없으면 dirty가 서지 않는다', () => {
    const seeded = seedWatchBuckets({ 0: 1 })
    expect(seeded.dirty).toBe(false)

    const advanced = advanceWatchBuckets(seeded, 1_000)
    expect(advanced.dirty).toBe(true)
    expect(markWatchBucketsSent(advanced).dirty).toBe(false)
  })

  it('진도는 본 칸 수로 센다 — 끝으로 끌어도 100%가 되지 않는다', () => {
    // 100초 강의 = 10칸. 마지막 칸만 본 경우.
    const jumped = advanceWatchBuckets(emptyWatchBucketState, 95_000)
    expect(bucketProgressPercent(jumped, 100_000)).toBe(10)

    let watched = emptyWatchBucketState
    for (let ms = 0; ms < 100_000; ms += 10_000) watched = advanceWatchBuckets(watched, ms)
    expect(bucketProgressPercent(watched, 100_000)).toBe(100)
  })

  it('전체 길이를 모르면 진도를 계산하지 않는다 — 라이브는 분모가 없다', () => {
    const state = advanceWatchBuckets(emptyWatchBucketState, 5_000)
    expect(bucketProgressPercent(state, null)).toBeNull()
    expect(bucketProgressPercent(state, 0)).toBeNull()
  })

  /**
   * 서버 응답이 낡을 수 있다. 캐시가 라이브 입장 때의 빈 목록을 들고 있는데 그걸로 덮으면 그 회차가
   * 통째로 사라진다 — 운영에서 23칸(92%)이 4%로 기록된 원인이다.
   */
  describe('서버 누적 합치기', () => {
    it('낡은 빈 응답이 지금까지 센 칸을 지우지 않는다', () => {
      let watched = emptyWatchBucketState
      for (let ms = 0; ms < 100_000; ms += 10_000) watched = advanceWatchBuckets(watched, ms)
      expect(bucketProgressPercent(watched, 100_000)).toBe(100)

      const merged = mergeWatchBuckets(watched, {})

      expect(bucketProgressPercent(merged, 100_000)).toBe(100)
      expect(merged.counts).toEqual(watched.counts)
    })

    it('서버가 더 많이 알고 있으면 물려받는다 — 다른 기기에서 본 회차', () => {
      const local = advanceWatchBuckets(emptyWatchBucketState, 0)

      const merged = mergeWatchBuckets(local, { 0: 1, 5: 3, 9: 1 })

      expect(Object.keys(merged.counts).length).toBe(3)
      expect(bucketProgressPercent(merged, 100_000)).toBe(30)
    })

    it('같은 칸은 큰 쪽을 남긴다 — 어느 쪽이 크든', () => {
      const local: WatchBucketState = { counts: { 0: 5, 1: 1 }, lastBucket: 1, dirty: false }

      const merged = mergeWatchBuckets(local, { 0: 2, 1: 4 })

      expect(merged.counts).toEqual({ 0: 5, 1: 4 })
    })

    it('지금 재생 중인 칸은 서버가 건드리지 않는다', () => {
      const local = advanceWatchBuckets(emptyWatchBucketState, 30_000)

      const merged = mergeWatchBuckets(local, { 0: 1 })

      expect(merged.lastBucket).toBe(3)
    })

    it('더할 것이 없으면 상태를 그대로 둔다', () => {
      const local: WatchBucketState = { counts: { 0: 2 }, lastBucket: 0, dirty: false }

      expect(mergeWatchBuckets(local, { 0: 1 })).toBe(local)
      expect(mergeWatchBuckets(local, {})).toBe(local)
    })
  })
})
