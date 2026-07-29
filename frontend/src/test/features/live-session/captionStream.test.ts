import { describe, expect, it } from 'vitest'
import {
  CAPTION_MAX_LINES,
  CAPTION_STT_LAG_MS,
  captionSeekMs,
  emptyCaptionStreamState,
  reduceCaptionStream,
  selectCaptionViews,
  selectVisibleCaptions,
} from '@/features/live-session/captionAdapter'
import type {
  CaptionStreamEvent,
  CaptionView,
} from '@/features/live-session/liveSessionService.interface'

function delta(
  sttSessionId: string,
  sequence: number,
  streamElapsedMs: number,
  text: string,
): CaptionStreamEvent {
  return { type: 'caption.delta', occurredAt: '2026-07-29T10:00:00+09:00', payload: { sttSessionId, sequence, streamElapsedMs, text } }
}

function syncedDelta(
  sttSessionId: string,
  sequence: number,
  sessionMs: number,
  text: string,
): CaptionStreamEvent {
  // streamElapsedMs(stream-local)와 sessionMs(세션 축)를 다르게 둬 어느 축을 쓰는지 구분한다.
  return { type: 'caption.delta', occurredAt: '2026-07-29T10:00:00+09:00', payload: { sttSessionId, sequence, streamElapsedMs: sessionMs + 900_000, sessionMs, text } }
}

function captionView(overrides: Partial<CaptionView> & { startMs: number }): CaptionView {
  return {
    segmentId: `seg-${overrides.startMs}`,
    endMs: overrides.startMs,
    at: '00:00',
    text: '자막',
    termReferences: [],
    ...overrides,
  }
}

function completed(sttSessionId: string, lastSequence: number): CaptionStreamEvent {
  return { type: 'caption.stream.completed', occurredAt: '2026-07-29T10:00:00+09:00', payload: { sttSessionId, lastSequence, reason: 'ROOM_DELETED' } }
}

function fold(events: CaptionStreamEvent[]) {
  return events.reduce(reduceCaptionStream, emptyCaptionStreamState())
}

describe('라이브 자막 델타 누적', () => {
  it('한 sttSession의 델타를 sequence 순서로 이어 붙여 자라는 한 라인을 만든다', () => {
    // 종결부호 없이 진행 중인 라인(문장 분할 시 마지막 조각 = pending). segmentId는 `sttSessionId#문장index`.
    const views = selectCaptionViews(fold([
      delta('stt-1', 1, 1_000, '인증이 '),
      delta('stt-1', 2, 2_000, '끝나면 '),
      delta('stt-1', 3, 3_000, 'SecurityContext가 남는다'),
    ]))

    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      segmentId: 'stt-1#0',
      text: '인증이 끝나면 SecurityContext가 남는다',
      startMs: 1_000,   // 문장 시작 offset의 시각(첫 델타)
      pending: true,
      termReferences: [],
    })
  })

  it('sttSession별로 별도 라인을 만들고 처음 등장 순서를 유지한다', () => {
    const views = selectCaptionViews(fold([
      delta('stt-a', 1, 1_000, '첫 스트림'),
      delta('stt-b', 1, 5_000, '둘째 스트림'),
      delta('stt-a', 2, 2_000, ' 이어짐'),
    ]))

    expect(views.map((view) => view.segmentId)).toEqual(['stt-a#0', 'stt-b#0'])
    expect(views[0].text).toBe('첫 스트림 이어짐')
    expect(views[1].text).toBe('둘째 스트림')
  })

  it('늦게 도착한 델타도 sequence 기준으로 정렬해 이어 붙인다', () => {
    const views = selectCaptionViews(fold([
      delta('stt-1', 2, 2_000, '나중 조각'),
      delta('stt-1', 1, 1_000, '먼저 조각 '),
    ]))

    expect(views[0].text).toBe('먼저 조각 나중 조각')
    expect(views[0].startMs).toBe(1_000)
  })

  it('같은 sequence의 중복 전달(at-least-once)은 멱등하게 무시한다', () => {
    const first = fold([delta('stt-1', 1, 1_000, '한 번')])
    const again = reduceCaptionStream(first, delta('stt-1', 1, 1_000, '한 번'))

    // 상태 참조가 그대로여야 불필요한 리렌더가 없다.
    expect(again).toBe(first)
    expect(selectCaptionViews(again)[0].text).toBe('한 번')
  })

  it('completed를 받으면 해당 라인을 확정(pending=false)한다', () => {
    const views = selectCaptionViews(fold([
      delta('stt-1', 1, 1_000, '확정될 문장'),
      completed('stt-1', 1),
    ]))

    expect(views[0].pending).toBe(false)
  })

  it('streamElapsedMs를 세션 ms로 바꾸지 않고 그대로 라벨로 쓴다', () => {
    const views = selectCaptionViews(fold([delta('stt-1', 1, 65_000, '경과 표시')]))
    // 65_000ms = 1:05, stream-local 경과 그대로.
    expect(views[0].at).toBe('01:05')
    expect(views[0].startMs).toBe(65_000)
  })

  it('델타 없이 completed만 온 라인은 렌더하지 않는다', () => {
    const views = selectCaptionViews(fold([completed('stt-1', 0)]))
    expect(views).toHaveLength(0)
  })
})

describe('근사 세션-ms 축 (ADR-0045)', () => {
  it('sessionMs가 있으면 startMs를 세션 축으로 두고 synced=true로 표시한다', () => {
    const views = selectCaptionViews(fold([syncedDelta('stt-1', 1, 42_000, '위치 동기화 자막')]))
    expect(views[0].startMs).toBe(42_000)   // streamElapsedMs(942_000)가 아니라 sessionMs
    expect(views[0].synced).toBe(true)
    expect(views[0].at).toBe('00:42')   // 42_000ms = 42초
  })

  it('sessionMs가 없으면 streamElapsedMs로 fallback하고 synced=false다', () => {
    const views = selectCaptionViews(fold([delta('stt-1', 1, 65_000, '앵커 없음')]))
    expect(views[0].startMs).toBe(65_000)
    expect(views[0].synced).toBe(false)
  })

  it('뒤 델타에서 시작한 문장은 그 델타의 방출 시각이 아니라 직전 델타 시각을 시작으로 잡는다', () => {
    // 델타 시각은 그 조각을 "내보낸" 시점이라, 그 조각의 말이 시작된 시점은 직전 델타 시각에 가깝다.
    // 두 번째 문장은 델타2에서 시작하므로 시작 시각은 델타2(20_000)가 아니라 델타1(10_000)이어야 한다.
    const views = selectCaptionViews(fold([
      syncedDelta('stt-1', 1, 10_000, '첫 문장이다. '),
      syncedDelta('stt-1', 2, 20_000, '둘째 문장이다.'),
    ]))

    expect(views).toHaveLength(2)
    expect(views[0].startMs).toBe(10_000)   // 첫 델타는 직전이 없어 자기 시각
    expect(views[1].startMs).toBe(10_000)   // 델타2의 말은 10_000부터 시작된 것
  })
})

describe('뷰어별 자막 노출 선택 (selectVisibleCaptions)', () => {
  const captions: CaptionView[] = [
    captionView({ startMs: 1_000, synced: true }),
    captionView({ startMs: 5_000, synced: true }),
    captionView({ startMs: 20_000, synced: true }),
  ]

  it('강사는 위치와 무관하게 전부 노출한다(실시간 append)', () => {
    const visible = selectVisibleCaptions(captions, { isInstructor: true, positionMs: 0 })
    expect(visible).toHaveLength(3)
  })

  it('학생은 재생 위치까지의 자막만 노출하고 앞선 자막은 감춘다', () => {
    // positionMs=5_000, STT 지연 보정 1_500 → 6_500 이하만. 20_000은 아직 앞서 있어 감춘다.
    const visible = selectVisibleCaptions(captions, { isInstructor: false, positionMs: 5_000 })
    expect(visible.map((caption) => caption.startMs)).toEqual([1_000, 5_000])
  })

  it('학생 화면에서 위치 축이 아닌 fallback 자막(synced=false)은 위치를 앞서도 그대로 노출한다', () => {
    // 위치=0. synced 자막(20_000)은 위치를 앞서 감춰지지만, 위치 축이 아닌 fallback은 판단 불가라 노출된다.
    const mixed: CaptionView[] = [
      captionView({ startMs: 20_000, synced: true }),
      captionView({ startMs: 20_000, synced: false }),
    ]
    const visible = selectVisibleCaptions(mixed, { isInstructor: false, positionMs: 0 })
    expect(visible.map((caption) => caption.synced)).toEqual([false])
  })
})

describe('자막 시각 클릭 seek 보정 (captionSeekMs)', () => {
  it('근사 축 자막은 STT 방출 지연만큼 앞으로 당겨 문장 시작에 닿게 한다', () => {
    const caption = captionView({ startMs: 42_000, synced: true })
    expect(captionSeekMs(caption)).toBe(42_000 - CAPTION_STT_LAG_MS)
  })

  it('세그먼트형(다시보기) 자막은 정확한 구간이라 보정하지 않는다', () => {
    const caption = captionView({ startMs: 42_000 })
    expect(captionSeekMs(caption)).toBe(42_000)
  })

  it('보정이 세션 시작을 넘어가면 0으로 clamp한다', () => {
    expect(captionSeekMs(captionView({ startMs: 500, synced: true }))).toBe(0)
  })

  it('보정 뒤 위치에서도 방금 누른 자막은 계속 보인다(노출 경계와 같은 상수)', () => {
    // seek 목표로 이동한 직후 그 줄이 사라지면 안 된다 — 두 곳이 같은 보정값이라 경계에 정확히 걸린다.
    const clicked = captionView({ startMs: 42_000, synced: true })
    const positionMs = captionSeekMs(clicked)
    expect(selectVisibleCaptions([clicked], { isInstructor: false, positionMs })).toEqual([clicked])
  })
})

describe('롤링 캡 (bounded 누적)', () => {
  it('상한을 넘으면 가장 오래된 라인을 drop하고 최근 라인을 유지한다', () => {
    const overflow = CAPTION_MAX_LINES + 5
    const events: CaptionStreamEvent[] = []
    for (let index = 0; index < overflow; index += 1) {
      events.push(delta(`stt-${index}`, 1, index * 1_000, `line ${index}`))
    }
    const state = fold(events)

    // 라인 수는 상한으로 bounded.
    expect(state.lines.size).toBe(CAPTION_MAX_LINES)
    // 가장 오래된 5개(stt-0..stt-4)는 drop.
    for (let index = 0; index < 5; index += 1) {
      expect(state.lines.has(`stt-${index}`)).toBe(false)
    }
    // 가장 최근 라인은 유지.
    expect(state.lines.has(`stt-${overflow - 1}`)).toBe(true)

    const views = selectCaptionViews(state)
    expect(views).toHaveLength(CAPTION_MAX_LINES)
    expect(views[0].segmentId).toBe('stt-5#0')
    expect(views[views.length - 1].segmentId).toBe(`stt-${overflow - 1}#0`)
  })
})
