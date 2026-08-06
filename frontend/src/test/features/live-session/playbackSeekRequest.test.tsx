import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * 재생 위치가 저절로 되돌아가던 버그의 회귀 테스트.
 *
 * 재생 metadata는 폴링으로 갱신되고(`usePlayback`의 refetchInterval) 그때마다 `playback.source`가
 * **새 객체**로 온다. seek 적용 effect가 source 동일성으로 재실행되면, 지난 seek 요청을 폴링 주기마다
 * 다시 적용해 학생 영상이 계속 그 위치로 끌려간다. 그래서 "새 요청일 때만"(sequence 기준) 적용해야 한다.
 */

interface PlayerDouble {
  currentTime: number
  seeks: number[]
}

const harness = vi.hoisted(() => ({ players: [] as PlayerDouble[] }))

vi.mock('@vidstack/react', async () => {
  const react = await import('react')
  return {
    isHLSProvider: () => false,
    MediaProvider: () => null,
    MediaPlayer: react.forwardRef(function MediaPlayerDouble(
      props: { children?: unknown },
      ref: React.Ref<PlayerDouble>,
    ) {
      const held = react.useRef<PlayerDouble | null>(null)
      if (!held.current) {
        const seeks: number[] = []
        let time = 0
        const player: PlayerDouble = {
          get currentTime() {
            return time
          },
          set currentTime(next: number) {
            time = next
            seeks.push(next)
          },
          seeks,
        }
        held.current = player
        harness.players.push(player)
      }
      react.useImperativeHandle(ref, () => held.current!, [])
      return react.createElement('div', null, props.children as React.ReactNode)
    }),
  }
})

vi.mock('@vidstack/react/player/layouts/default', () => ({
  DefaultVideoLayout: () => null,
  defaultLayoutIcons: {},
}))

import PlaybackPlayer, { toMediaTimeSeconds } from '@/features/live-session/PlaybackPlayer'
import type { PlaybackSeekRequest } from '@/features/live-session/PlaybackPlayer'
import type { PlaybackView } from '@/features/live-session/liveSessionService'

// 값은 같지만 매번 새 객체 — 폴링 갱신이 만들어 내는 상황 그대로다.
function pollingPlayback(): PlaybackView {
  return {
    lessonId: 'les-1',
    sessionId: 'ses-1',
    liveSessionStatus: 'LIVE',
    replayStatus: 'DRAFT',
    currentSessionMs: 600_000,
    durationMs: null,
    source: { url: '/api/lessons/les-1/playback/manifest', availableFromMs: 1_250, availableToMs: 600_000 },
  }
}

function renderPlayer(playback: PlaybackView, seekRequest: PlaybackSeekRequest | null) {
  return (
    <PlaybackPlayer
      errorMessage={null}
      lessonTitle="테스트 강의"
      loading={false}
      participantCount={1}
      playback={playback}
      reloadToken={0}
      seekRequest={seekRequest}
      onBookmark={() => {}}
      onRetry={() => {}}
      onSessionTimeChange={() => {}}
    />
  )
}

describe('재생 seek 요청 적용', () => {
  it('폴링으로 source가 새 객체가 돼도 지난 seek 요청을 다시 적용하지 않는다', () => {
    harness.players.length = 0
    const seek: PlaybackSeekRequest = { sessionMs: 300_000, sequence: 1 }

    const { rerender } = render(renderPlayer(pollingPlayback(), seek))
    const player = harness.players[0]
    expect(player.seeks).toEqual([toMediaTimeSeconds(300_000, 1_250)])

    // 폴링 갱신 3회: playback·source가 새 객체가 되지만 seek 요청은 그대로(sequence 불변).
    // 여기서 다시 적용되면 학생이 보던 위치가 매 폴링마다 300초로 끌려간다.
    for (let tick = 0; tick < 3; tick += 1) {
      rerender(renderPlayer(pollingPlayback(), { ...seek }))
    }

    expect(player.seeks).toHaveLength(1)
  })

  it('새 seek 요청(sequence 증가)은 같은 시각이라도 다시 적용한다', () => {
    harness.players.length = 0
    const { rerender } = render(renderPlayer(pollingPlayback(), { sessionMs: 300_000, sequence: 1 }))
    const player = harness.players[0]

    // 같은 자막 시각을 다시 눌렀을 때 — sequence가 이를 구분해 준다.
    rerender(renderPlayer(pollingPlayback(), { sessionMs: 300_000, sequence: 2 }))

    const expected = toMediaTimeSeconds(300_000, 1_250)
    expect(player.seeks).toEqual([expected, expected])
  })

  it('source가 아직 없어 못 옮긴 요청은 source가 준비되면 그때 한 번 적용한다', () => {
    harness.players.length = 0
    const seek: PlaybackSeekRequest = { sessionMs: 300_000, sequence: 1 }
    const withoutSource: PlaybackView = { ...pollingPlayback(), source: null }

    const { rerender } = render(renderPlayer(withoutSource, seek))
    expect(harness.players).toHaveLength(0)   // source가 없으면 플레이어 자체가 없다

    rerender(renderPlayer(pollingPlayback(), seek))
    expect(harness.players[0].seeks).toEqual([toMediaTimeSeconds(300_000, 1_250)])
  })
})
