/**
 * 구간별 시청 횟수 집계(CONTRACT §2 학습, ADR-0063).
 *
 * 재생 위치가 흐르는 동안 지나간 칸을 센다. 서버에는 <b>누적 절대값</b>을 보내므로 재전송이
 * 횟수를 부풀리지 않는다.
 */

/** 계약이 고정한 칸 길이. 서버와 달라지면 400으로 거절된다. */
export const BUCKET_SIZE_MS = 10_000

export function bucketOf(sessionMs: number): number {
  return Math.max(0, Math.floor(sessionMs / BUCKET_SIZE_MS))
}

export interface WatchBucketState {
  /** 칸번호 → 재생 횟수(누적). */
  counts: Record<number, number>
  /** 직전에 센 칸. 같은 칸 안에서 위치만 움직이는 동안은 다시 세지 않는다. */
  lastBucket: number | null
  /** 서버로 보낸 뒤 바뀐 것이 있는가. 없으면 전송을 건너뛴다. */
  dirty: boolean
}

export const emptyWatchBucketState: WatchBucketState = { counts: {}, lastBucket: null, dirty: false }

/** 서버에 이미 쌓인 내 누적으로 시작한다 — 새로고침 뒤 0부터 세면 그 회차가 사라진다. */
export function seedWatchBuckets(counts: Record<number, number>): WatchBucketState {
  return { counts: { ...counts }, lastBucket: null, dirty: false }
}

/**
 * 서버 누적을 지금 상태에 <b>합친다</b>. 칸마다 큰 쪽을 남긴다.
 *
 * <p>덮어쓰지 않는 이유는 서버 응답이 낡을 수 있어서다 — 캐시가 라이브 입장 때의 빈 목록을 들고
 * 있으면 그걸로 덮는 순간 그 회차가 통째로 사라진다. 실제로 그렇게 92%가 4%로 기록된 적이 있다.
 *
 * <p>반대로 서버가 더 많이 알고 있을 수도 있다(다른 기기에서 본 회차). 그래서 <b>둘 중 큰 쪽</b>이
 * 맞고, 값이 누적 절대값이라 몇 번을 합쳐도 결과가 같다.
 *
 * <p>{@code lastBucket}은 건드리지 않는다 — 그건 "지금 재생 중인 칸"이라 서버가 알 바가 아니다.
 */
export function mergeWatchBuckets(
  state: WatchBucketState,
  serverCounts: Record<number, number>,
): WatchBucketState {
  const counts = { ...state.counts }
  let changed = false
  for (const [key, value] of Object.entries(serverCounts)) {
    const bucket = Number(key)
    if (!Number.isFinite(bucket)) continue
    if ((counts[bucket] ?? 0) < value) {
      counts[bucket] = value
      changed = true
    }
  }
  // 합친 결과가 서버가 준 것과 같다면 다시 보낼 것이 없다. 우리 쪽이 더 큰 칸이 있으면 그대로 둔다.
  return changed ? { ...state, counts } : state
}

/**
 * 재생 위치를 반영한다.
 *
 * <p><b>칸이 바뀔 때만</b> 센다. 위치 갱신은 초당 여러 번 오는데 그때마다 세면 한 칸이 수십 번
 * 재생된 것으로 잡힌다.
 *
 * <p>되감아 같은 칸으로 돌아오면 <b>다시 센다</b> — 그게 이 기능이 잡으려는 신호다.
 */
export function advanceWatchBuckets(state: WatchBucketState, sessionMs: number): WatchBucketState {
  const bucket = bucketOf(sessionMs)
  if (state.lastBucket === bucket) return state
  return {
    counts: { ...state.counts, [bucket]: (state.counts[bucket] ?? 0) + 1 },
    lastBucket: bucket,
    dirty: true,
  }
}

/** 전송 뒤 호출한다. 보낸 내용은 그대로 두고 "보낼 것 없음"으로만 표시한다. */
export function markWatchBucketsSent(state: WatchBucketState): WatchBucketState {
  return state.dirty ? { ...state, dirty: false } : state
}

/**
 * 칸 기준 진도율. 재생 위치가 아니라 <b>본 칸 수</b>로 센다 — 끝으로 끌어도 100%가 되지 않는다.
 *
 * @param durationMs 전체 길이. 모르면(라이브 진행 중) null을 돌려준다.
 */
export function bucketProgressPercent(state: WatchBucketState, durationMs: number | null): number | null {
  if (!durationMs || durationMs <= 0) return null
  const total = Math.max(1, Math.ceil(durationMs / BUCKET_SIZE_MS))
  const watched = Object.keys(state.counts).length
  return Math.max(0, Math.min(100, Math.round((watched / total) * 100)))
}
