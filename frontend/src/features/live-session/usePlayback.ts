import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { getPlayback, isLiveStatus, type PlaybackView } from './liveSessionService'

/**
 * 재생 metadata 조회·폴링. 라이브 강의실과 다시보기 화면이 공유한다.
 *
 * BE는 라이브와 종료 후 VOD를 같은 엔드포인트로 제공하고 `liveSessionStatus`로만 구분하므로
 * (CONTRACT §2 다시보기), 화면이 달라도 이 로직은 하나면 된다.
 */

/** 오류코드는 CONTRACT §2 다시보기 · ADR-choinhoo/0001 오류표가 정본이다. */
export function getPlaybackErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return '재생 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  if (error.code === 'ENROLLMENT_REQUIRED') return '이 강의를 수강해야 시청할 수 있습니다.'
  if (error.code === 'LESSON_NOT_FOUND') return '강의를 찾을 수 없습니다.'
  if (error.code === 'REPLAY_NOT_FOUND') return '시청할 수 있는 영상이 없습니다.'
  if (error.code === 'RECORDING_STARTING') return '녹화가 시작되는 중입니다. 곧 재생됩니다.'
  if (error.code === 'REPLAY_NOT_READY') return '영상이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.'
  if (error.code === 'PLAYBACK_STORAGE_UNAVAILABLE') return '영상 저장소에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.'
  if (error.code === 'PLAYBACK_CONTRACT_INVALID') return '재생 정보가 올바르게 전달되지 않았습니다.'
  return error.message || '재생 정보를 가져오지 못했습니다.'
}

/**
 * 폴링 주기.
 *
 * source가 없으면(Egress 지연) 짧게 되물어 재생 시작을 놓치지 않고, 재생 중이면 세션 종료만
 * 감지하면 되므로 길게 잡는다. 종료 후에는 더 바뀔 게 없어 멈춘다.
 */
export function playbackPollInterval(data: PlaybackView | undefined) {
  if (!data) return SOURCE_WAIT_INTERVAL_MS
  if (!isLiveStatus(data.liveSessionStatus)) return false as const
  return data.source ? LIVE_WATCH_INTERVAL_MS : SOURCE_WAIT_INTERVAL_MS
}

const SOURCE_WAIT_INTERVAL_MS = 3_000
const LIVE_WATCH_INTERVAL_MS = 30_000

export interface UsePlaybackResult {
  playback: PlaybackView | null
  /** 재생 정보를 아직 못 받았다(첫 조회 중). source가 null인 대기 상태와는 다르다. */
  loading: boolean
  errorMessage: string | null
  /**
   * 플레이어 리마운트 트리거. 명시적 재시도에만 증가한다 — 폴링 갱신마다 바꾸면
   * 매번 플레이어가 새로 뜨면서 재생이 끊긴다.
   */
  reloadToken: number
  reload: () => void
}

export function usePlayback(lessonId: string | undefined, enabled = true): UsePlaybackResult {
  const [reloadToken, setReloadToken] = useState(0)
  const query = useQuery({
    queryKey: ['playback', lessonId],
    queryFn: () => getPlayback(lessonId!),
    enabled: Boolean(lessonId) && enabled,
    retry: false,
    refetchInterval: (q) => playbackPollInterval(q.state.data),
  })

  const reload = useCallback(() => {
    // 세그먼트 403(presigned TTL 만료)·재생 오류 복구 경로 — 새 URL을 받아 플레이어를 다시 문다.
    setReloadToken((token) => token + 1)
    void query.refetch()
  }, [query])

  return {
    playback: query.data ?? null,
    loading: enabled && query.isPending,
    errorMessage: query.isError ? getPlaybackErrorMessage(query.error) : null,
    reloadToken,
    reload,
  }
}
