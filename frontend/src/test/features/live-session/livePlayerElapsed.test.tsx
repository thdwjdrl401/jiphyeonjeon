import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/*
 * 경과 시각은 이제 vidstack 컨트롤바 안(`afterLiveButton` 슬롯)에 그린다 — 사람이 시간을 찾는 곳이
 * 거기이기 때문이다. 그 렌더는 vidstack이 맡으므로 여기서는 띄우지 않고, 대신 <b>축이 맞는지</b>만
 * 본다: 플레이어에 넘어가는 값은 미디어 시각이고 위로 올라가는 값은 세션 시각이어야 한다.
 */
let emitTimeChange: ((mediaTimeMs: number) => void) | null = null

let lastProps: { streamType?: string } | null = null

vi.mock('@/features/media/HlsMediaPlayer', () => ({
  default: (props: { onTimeChange?: (mediaTimeMs: number) => void; streamType?: string }) => {
    emitTimeChange = props.onTimeChange ?? null
    lastProps = props
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
  it('라이브면 플레이어에 live:dvr로 넘긴다', () => {
    // 이 값이 라이브 레이아웃을 만들고, 경과 시각은 그 레이아웃의 LIVE 배지 옆 슬롯에 들어간다.
    renderLive()
    expect(lastProps?.streamType).toBe('live:dvr')
  })

  it('컨트롤바에 찍힐 숫자는 그 자막의 라벨과 같다', () => {
    /*
     * 이 등식이 이 기능의 전부다. 라벨은 "눌러서 갈 자리"를 말하므로, 그 자리에 도착한 뒤 컨트롤바가
     * 다른 숫자를 보이면 사용자는 이동이 잘못된 것으로 읽는다.
     *
     * <p>렌더는 vidstack 레이아웃이 맡으므로 여기서는 <b>같은 값을 만들어 내는지</b>만 본다.
     */
    const caption = {
      segmentId: 'seg-1',
      startMs: 194_000 + AVAILABLE_FROM_MS,   // 세션 축 자막
      endMs: 197_000 + AVAILABLE_FROM_MS,
      at: '03:21',
      text: '눌러서 이동할 자막',
      termReferences: [],
      synced: true,
    }

    // 자막을 눌렀을 때 플레이어가 실제로 가는 지점(미디어 축).
    const landedMediaMs = captionSeekMs(caption) - AVAILABLE_FROM_MS

    expect(formatTimeLabel(landedMediaMs)).toBe(captionDisplayLabel(caption, AVAILABLE_FROM_MS))
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
    // 다시보기는 vidstack이 이미 `mm:ss / 총길이`를 그리므로 슬롯을 넣지 않는다.
    expect(lastProps?.streamType).toBe('on-demand')
  })
})
