import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PlaybackPlayer, {
  toMediaTimeSeconds,
  toSessionMs,
} from '@/features/live-session/PlaybackPlayer'
import { isLiveStatus, type PlaybackView } from '@/features/live-session/liveSessionService'

function playbackFixture(overrides: Partial<PlaybackView> = {}): PlaybackView {
  return {
    lessonId: 'les-1',
    sessionId: 'ses-1',
    liveSessionStatus: 'LIVE',
    replayStatus: 'DRAFT',
    currentSessionMs: 60_000,
    durationMs: null,
    source: { url: '/api/lessons/les-1/playback/manifest', availableFromMs: 1_250, availableToMs: 60_000 },
    ...overrides,
  }
}

describe('재생 플레이어', () => {
  it('미디어 시각과 세션 시각을 source 시작점 기준으로 양방향 변환한다', () => {
    // 기준은 source.availableFromMs — 미디어 시각 0이 가리키는 세션 시각이다.
    expect(toSessionMs(12.5, 1_250)).toBe(13_750)
    expect(toMediaTimeSeconds(13_750, 1_250)).toBe(12.5)
    expect(toMediaTimeSeconds(500, 1_250)).toBe(0)
  })

  it('세션 상태로 라이브 여부를 가른다', () => {
    expect(isLiveStatus('STARTING')).toBe(true)
    expect(isLiveStatus('LIVE')).toBe(true)
    expect(isLiveStatus('ENDING')).toBe(true)
    expect(isLiveStatus('ENDED')).toBe(false)
  })

  it('실제 재생 주소 조회 실패를 표시하고 재시도할 수 있다', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    render(
      <PlaybackPlayer
        errorMessage="영상이 아직 준비되지 않았습니다."
        lessonTitle="세션별 라이브"
        loading={false}
        participantCount={3}
        playback={null}
        reloadToken={0}
        seekRequest={null}
        onBookmark={() => undefined}
        onRetry={onRetry}
        onSessionTimeChange={() => undefined}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('영상이 아직 준비되지 않았습니다.')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('source가 없으면 오류가 아니라 준비 중으로 안내한다', () => {
    // Egress 지연은 정상 상태다. 오류로 표시하면 사용자가 기다리지 않고 이탈한다.
    render(
      <PlaybackPlayer
        errorMessage={null}
        lessonTitle="세션별 라이브"
        loading={false}
        participantCount={3}
        playback={playbackFixture({ source: null, liveSessionStatus: 'STARTING' })}
        reloadToken={0}
        seekRequest={null}
        onBookmark={() => undefined}
        onRetry={() => undefined}
        onSessionTimeChange={() => undefined}
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('영상이 곧 시작됩니다.')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('세션이 끝나면 LIVE 표시를 내린다', () => {
    render(
      <PlaybackPlayer
        errorMessage={null}
        lessonTitle="종료된 강의"
        loading={false}
        participantCount={0}
        playback={playbackFixture({ liveSessionStatus: 'ENDED', durationMs: 600_000 })}
        reloadToken={0}
        seekRequest={null}
        onBookmark={() => undefined}
        onRetry={() => undefined}
        onSessionTimeChange={() => undefined}
      />,
    )

    const header = screen.getByLabelText('재생 정보')
    expect(header).toHaveTextContent('다시보기')
    expect(header).not.toHaveTextContent('LIVE')
  })
})
