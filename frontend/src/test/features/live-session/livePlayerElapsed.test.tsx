import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/*
 * 실제 vidstack을 띄우지 않는다. 여기서 확인할 것은 미디어 element의 동작이 아니라 <b>어느 축의 숫자를
 * 헤더에 찍는가</b>이고, 그건 onTimeChange가 준 값을 어떻게 쓰느냐로 결정된다. 가짜 플레이어가
 * 그 콜백을 그대로 노출하면 시각 갱신을 결정적으로 흉내 낼 수 있다.
 */
let emitTimeChange: ((mediaTimeMs: number) => void) | null = null

vi.mock('@/features/media/HlsMediaPlayer', () => ({
  default: (props: { onTimeChange?: (mediaTimeMs: number) => void }) => {
    emitTimeChange = props.onTimeChange ?? null
    return <div data-testid="fake-player" />
  },
}))

const { default: PlaybackPlayer } = await import('@/features/live-session/PlaybackPlayer')
const { captionDisplayLabel, captionSeekMs, formatTimeLabel } =
  await import('@/features/live-session/captionAdapter')
type PlaybackView = import('@/features/live-session/liveSessionService').PlaybackView

// 녹화가 세션보다 7초 늦게 시작한 상황 — 두 축이 실제로 갈리는 조건이라야 의미 있는 검증이 된다.
const AVAILABLE_FROM_MS = 7_000

function renderLive(onSessionTimeChange = () => undefined) {
  const playback: PlaybackView = {
    lessonId: 'les-1',
    sessionId: 'ses-1',
    liveSessionStatus: 'LIVE',
    replayStatus: 'DRAFT',
    currentSessionMs: 0,
    durationMs: null,
    source: {
      url: '/api/lessons/les-1/playback/manifest',
      availableFromMs: AVAILABLE_FROM_MS,
      availableToMs: null,
    },
  }
  return render(
    <PlaybackPlayer
      errorMessage={null}
      lessonTitle="라이브 강의"
      loading={false}
      playback={playback}
      reloadToken={0}
      seekRequest={null}
      onRetry={() => undefined}
      onSessionTimeChange={onSessionTimeChange}
    />,
  )
}

describe('라이브 플레이어 경과 시각', () => {
  it('라이브에서는 헤더에 재생 위치를 찍는다', () => {
    // 라이브 컨트롤바는 LIVE 배지만 보이고 시각이 없다. 되감았을 때 어디를 보고 있는지 알 수단이 헤더뿐이다.
    renderLive()
    act(() => emitTimeChange?.(194_000))

    expect(screen.getByLabelText('재생 위치')).toHaveTextContent('03:14')
  })

  it('자막을 눌러 이동하면 헤더가 그 자막의 라벨과 같은 숫자를 찍는다', () => {
    /*
     * 이 등식이 이 기능의 전부다. 라벨은 "눌러서 갈 자리"를 말하므로, 그 자리에 도착한 뒤 헤더가
     * 다른 숫자를 보이면 사용자는 이동이 잘못된 것으로 읽는다. 헤더가 세션 축을 찍으면
     * availableFromMs만큼 어긋난다.
     */
    const caption = {
      segmentId: 'seg-1',
      startMs: 194_000 + AVAILABLE_FROM_MS,   // 세션 축 자막
      endMs: 197_000 + AVAILABLE_FROM_MS,
      at: '03:21',
      text: '눌러서 이동할 자막',
      termReferences: [],
      synced: true,
      anchored: true,
    }

    renderLive()
    // 자막을 눌렀을 때 플레이어가 실제로 가는 지점(미디어 축).
    act(() => emitTimeChange?.(captionSeekMs(caption) - AVAILABLE_FROM_MS))

    expect(screen.getByLabelText('재생 위치'))
      .toHaveTextContent(captionDisplayLabel(caption, AVAILABLE_FROM_MS))
  })

  it('세션 축은 그대로 위로 올린다(표시축과 별개다)', () => {
    // 헤더는 미디어 축을 보이지만, 자막 노출·AI 질의가 쓰는 위치는 세션 축이어야 한다.
    const onSessionTimeChange = vi.fn()
    renderLive(onSessionTimeChange)
    act(() => emitTimeChange?.(194_000))

    expect(onSessionTimeChange).toHaveBeenCalledWith(194_000 + AVAILABLE_FROM_MS)
  })

  it('다시보기에서는 헤더에 찍지 않는다(컨트롤바가 이미 보여 준다)', () => {
    const playback: PlaybackView = {
      lessonId: 'les-1',
      sessionId: 'ses-1',
      liveSessionStatus: 'ENDED',
      replayStatus: 'PUBLISHED',
      currentSessionMs: 0,
      durationMs: 600_000,
      source: { url: '/m.m3u8', availableFromMs: AVAILABLE_FROM_MS, availableToMs: 600_000 },
    }
    render(
      <PlaybackPlayer
        errorMessage={null}
        lessonTitle="끝난 강의"
        loading={false}
        playback={playback}
        reloadToken={0}
        seekRequest={null}
        onRetry={() => undefined}
        onSessionTimeChange={() => undefined}
      />,
    )
    act(() => emitTimeChange?.(194_000))

    expect(screen.queryByLabelText('재생 위치')).not.toBeInTheDocument()
    // 형식 규칙은 자막과 공유한다 — 여기서 다시 구현하면 둘이 갈라진다.
    expect(formatTimeLabel(194_000)).toBe('03:14')
  })
})
