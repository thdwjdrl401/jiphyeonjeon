import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api/client'
import {
  getPlaybackErrorMessage,
  playbackPollInterval,
} from '@/features/live-session/usePlayback'
import type { PlaybackView } from '@/features/live-session/liveSessionService'

function view(overrides: Partial<PlaybackView> = {}): PlaybackView {
  return {
    lessonId: 'les-1',
    sessionId: 'ses-1',
    liveSessionStatus: 'LIVE',
    currentSessionMs: 0,
    durationMs: null,
    source: { url: '/api/lessons/les-1/playback/manifest', availableFromMs: 0, availableToMs: 0 },
    ...overrides,
  }
}

describe('재생 폴링 주기', () => {
  it('아직 응답이 없으면 짧게 되묻는다', () => {
    expect(playbackPollInterval(undefined)).toBe(3_000)
  })

  it('라이브인데 source가 없으면 짧게 되묻는다', () => {
    // Egress가 첫 세그먼트를 올리는 순간을 놓치지 않아야 한다.
    expect(playbackPollInterval(view({ source: null, liveSessionStatus: 'STARTING' }))).toBe(3_000)
  })

  it('라이브 재생 중에는 길게 — 세션 종료만 감지하면 된다', () => {
    expect(playbackPollInterval(view())).toBe(30_000)
  })

  it('세션이 끝나면 멈춘다', () => {
    // ENDED 이후로는 더 바뀔 게 없다. 계속 물으면 서버만 때린다.
    expect(playbackPollInterval(view({ liveSessionStatus: 'ENDED', durationMs: 600_000 }))).toBe(false)
  })
})

describe('재생 오류 메시지', () => {
  it('BE 오류코드를 사용자 문구로 옮긴다', () => {
    expect(getPlaybackErrorMessage(new ApiError('x', 409, 'RECORDING_STARTING')))
      .toContain('녹화가 시작되는 중')
    expect(getPlaybackErrorMessage(new ApiError('x', 403, 'ENROLLMENT_REQUIRED')))
      .toContain('수강해야')
    expect(getPlaybackErrorMessage(new ApiError('x', 503, 'PLAYBACK_STORAGE_UNAVAILABLE')))
      .toContain('저장소')
  })

  it('ApiError가 아니면 연결 실패로 안내한다', () => {
    expect(getPlaybackErrorMessage(new Error('boom'))).toContain('연결하지 못했습니다')
  })
})
