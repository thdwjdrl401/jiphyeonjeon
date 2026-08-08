import { describe, expect, it } from 'vitest'
import {
  CAPTION_MAX_LINES,
  CAPTION_STT_LAG_MS,
  captionDisplayLabel,
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

function segmentFinal(
  sttSessionId: string,
  segmentIndex: number,
  lastSequence: number,
  startStreamElapsedMs: number,
  text: string,
  overrides: Partial<Extract<CaptionStreamEvent, { type: 'caption.segment.final' }>['payload']> = {},
): CaptionStreamEvent {
  return {
    type: 'caption.segment.final',
    occurredAt: '2026-07-29T10:00:00+09:00',
    payload: {
      sttSessionId,
      segmentIndex,
      lastSequence,
      text,
      startStreamElapsedMs,
      endStreamElapsedMs: startStreamElapsedMs + 3_000,
      boundaryReason: 'SILENCE',
      sessionMs: null,
      anchoredSessionMs: null,
      ...overrides,
    },
  }
}

function fold(events: CaptionStreamEvent[]) {
  return events.reduce(reduceCaptionStream, emptyCaptionStreamState())
}

describe('라이브 자막 델타 누적', () => {
  it('한 sttSession의 델타를 sequence 순서로 이어 붙여 자라는 한 라인을 만든다', () => {
    // 세그먼트 확정 전이라 델타 전체가 진행 중(pending) 조각 하나다. segmentId는 `sttSessionId#0`.
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

  it('세그먼트 확정 전의 델타들은 문장부호로 쪼개지 않고 하나의 진행 중 조각으로 이어 붙인다', () => {
    // ADR-0044 문장부호 휴리스틱 제거: segment.final이 오기 전엔 종결부호가 있어도 한 pending 라인이다.
    // 진행 중 조각의 시작 시각은 첫 델타(직전 없음)의 자기 시각(10_000)이다.
    const views = selectCaptionViews(fold([
      syncedDelta('stt-1', 1, 10_000, '첫 문장이다. '),
      syncedDelta('stt-1', 2, 20_000, '둘째 문장이다.'),
    ]))

    expect(views).toHaveLength(1)
    expect(views[0].text).toBe('첫 문장이다. 둘째 문장이다.')
    expect(views[0].startMs).toBe(10_000)
    expect(views[0].pending).toBe(true)
    expect(views[0].synced).toBe(true)
  })
})

describe('확정 세그먼트 경계 (caption.segment.final)', () => {
  it('세그먼트마다 권위 있는 CaptionView를 segmentIndex 순으로 낸다(pending=false, raw startStreamElapsedMs)', () => {
    const views = selectCaptionViews(fold([
      delta('stt-1', 1, 1_000, '인증이 끝나면 '),
      delta('stt-1', 2, 2_000, 'SecurityContext가 남는다. '),
      segmentFinal('stt-1', 0, 2, 1_000, '인증이 끝나면 SecurityContext가 남는다.'),
      delta('stt-1', 3, 3_000, '다음은 필터 순서다.'),
      segmentFinal('stt-1', 1, 3, 2_500, '다음은 필터 순서다.'),
    ]))

    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({
      segmentId: 'stt-1#0',
      text: '인증이 끝나면 SecurityContext가 남는다.',
      startMs: 1_000,
      endMs: 4_000,
      at: '00:01',
      pending: false,
      synced: false,
    })
    expect(views[1]).toMatchObject({
      segmentId: 'stt-1#1',
      text: '다음은 필터 순서다.',
      startMs: 2_500,
      pending: false,
    })
  })

  it('세그먼트에 sessionMs가 있으면 끝에서 구간 길이를 빼 세션 축 시작을 잡고 synced=true다', () => {
    // stream-local은 900_000부터 시작하게 두어(=STT가 늦게 붙은 상황) 어느 축을 썼는지 구분한다.
    // sessionMs=45_000은 세그먼트가 **끝난** 시각이므로, 길이 3_000을 뺀 42_000이 시작이어야 한다.
    const views = selectCaptionViews(fold([
      segmentFinal('stt-1', 0, 2, 900_000, '세션 축으로 옮겨야 한다.', { sessionMs: 45_000 }),
    ]))

    expect(views[0]).toMatchObject({ startMs: 42_000, endMs: 45_000, at: '00:42', synced: true })
  })

  it('세션 축 세그먼트는 재생 위치를 앞서면 감춰진다(다시보기에서 전부 노출되지 않는다)', () => {
    // 이게 깨지면 다시보기에서 강의 끝 자막까지 처음부터 다 떠 있게 된다.
    const views = selectCaptionViews(fold([
      segmentFinal('stt-1', 0, 1, 900_000, '지금 지점의 말이다.', { sessionMs: 20_000 }),
      segmentFinal('stt-1', 1, 2, 960_000, '한참 뒤의 말이다.', { sessionMs: 300_000 }),
    ]))

    expect(selectVisibleCaptions(views, 30_000).map((view) => view.text))
      .toEqual(['지금 지점의 말이다.'])
  })

  it('세션 축 세그먼트의 seek 목표는 STT 방출 지연만큼 당겨진다', () => {
    const [view] = selectCaptionViews(fold([
      segmentFinal('stt-1', 0, 1, 900_000, '문장 시작에 닿아야 한다.', { sessionMs: 45_000 }),
    ]))

    expect(view.startMs).toBe(42_000)
    expect(captionSeekMs(view)).toBe(42_000 - CAPTION_STT_LAG_MS)
  })

  it('앵커가 있으면 근사(sessionMs)를 제치고 앵커 값을 시작으로 쓴다', () => {
    // sessionMs(도착 기준 근사)와 anchoredSessionMs(정확)를 다르게 둬 어느 쪽을 골랐는지 구분한다.
    const views = selectCaptionViews(fold([
      segmentFinal('stt-1', 0, 1, 900_000, '앵커가 정본이다.', { sessionMs: 45_000, anchoredSessionMs: 40_000 }),
    ]))

    expect(views[0]).toMatchObject({ startMs: 40_000, endMs: 43_000, synced: true, anchored: true })
  })

  it('앵커 자막은 STT 지연 보정을 받지 않는다(seek·노출 모두)', () => {
    // 앵커 값은 실제 발화 시각이라 보정하면 그만큼 이르게 어긋난다.
    const [anchored] = selectCaptionViews(fold([
      segmentFinal('stt-1', 0, 1, 900_000, '보정 없음.', { anchoredSessionMs: 40_000 }),
    ]))
    const [approx] = selectCaptionViews(fold([
      segmentFinal('stt-2', 0, 1, 900_000, '보정 있음.', { sessionMs: 43_000 }),
    ]))

    expect(captionSeekMs(anchored)).toBe(40_000)
    expect(captionSeekMs(approx)).toBe(40_000 - CAPTION_STT_LAG_MS)

    // 노출 경계도 같다 — 재생 위치가 딱 시작일 때 앵커는 뜨고, 근사는 보정만큼 미리 떠 있다.
    expect(selectVisibleCaptions([anchored], 40_000)).toHaveLength(1)
    expect(selectVisibleCaptions([anchored], 40_000 - 1)).toHaveLength(0)
    expect(selectVisibleCaptions([approx], 40_000 - CAPTION_STT_LAG_MS)).toHaveLength(1)
  })

  it('앵커가 없으면 종전 근사 경로를 그대로 쓴다(옛 세션 회귀)', () => {
    const views = selectCaptionViews(fold([
      segmentFinal('stt-1', 0, 1, 900_000, '근사로 물러난다.', { sessionMs: 45_000 }),
    ]))

    expect(views[0]).toMatchObject({ startMs: 42_000, synced: true, anchored: false })
  })

  it('델타도 앵커를 우선한다', () => {
    const views = selectCaptionViews(fold([
      {
        type: 'caption.delta',
        occurredAt: '2026-07-29T10:00:00+09:00',
        payload: {
          sttSessionId: 'stt-1', sequence: 1, streamElapsedMs: 900_000,
          sessionMs: 45_000, anchoredSessionMs: 40_000, text: '진행 중 조각도 앵커를 쓴다.',
        },
      },
    ]))

    expect(views[0]).toMatchObject({ startMs: 40_000, synced: true, anchored: true })
  })

  it('세그먼트가 덮지 않은(sequence > lastSequence) 델타는 뒤에 진행 중 조각으로 붙는다', () => {
    const views = selectCaptionViews(fold([
      delta('stt-1', 1, 1_000, '확정된 문장이다. '),
      segmentFinal('stt-1', 0, 1, 1_000, '확정된 문장이다.'),
      delta('stt-1', 2, 2_000, '아직 말하는 중'),
    ]))

    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ segmentId: 'stt-1#0', text: '확정된 문장이다.', pending: false })
    // 진행 중 조각은 세그먼트 뒤 index로, pending=true.
    expect(views[1]).toMatchObject({ segmentId: 'stt-1#1', text: '아직 말하는 중', pending: true })
  })

  it('나중 세그먼트가 진행 중 조각을 덮으면 조각이 사라진다(권위 텍스트로 대체)', () => {
    const withPartial = selectCaptionViews(fold([
      delta('stt-1', 1, 1_000, '말하는 중 '),
      delta('stt-1', 2, 2_000, '계속'),
    ]))
    expect(withPartial).toHaveLength(1)
    expect(withPartial[0].pending).toBe(true)

    const finalized = selectCaptionViews(fold([
      delta('stt-1', 1, 1_000, '말하는 중 '),
      delta('stt-1', 2, 2_000, '계속'),
      segmentFinal('stt-1', 0, 2, 1_000, '말하는 중 계속.'),
    ]))
    // 델타 두 개가 모두 lastSequence=2에 덮여 진행 중 조각은 없어지고, 권위 세그먼트만 남는다.
    expect(finalized).toHaveLength(1)
    expect(finalized[0]).toMatchObject({ segmentId: 'stt-1#0', text: '말하는 중 계속.', pending: false })
  })

  it('같은 segmentIndex 재전달은 마지막 값으로 대체한다(멱등, last-wins)', () => {
    const views = selectCaptionViews(fold([
      segmentFinal('stt-1', 0, 1, 1_000, '먼저 온 텍스트'),
      segmentFinal('stt-1', 0, 1, 1_000, '교정된 텍스트'),
    ]))

    expect(views).toHaveLength(1)
    expect(views[0].text).toBe('교정된 텍스트')
  })
})

describe('자막 라벨은 플레이어와 같은 축으로 보인다 (captionDisplayLabel)', () => {
  it('세션 축 시각을 availableFromMs만큼 내려 미디어 축으로 보여 준다', () => {
    // 녹화가 세션보다 7초 늦게 시작했다면, 세션 03:14는 플레이어에서 03:07이다.
    const caption = captionView({ startMs: 194_000, synced: true, at: '03:14' })
    expect(captionDisplayLabel(caption, 7_000)).toBe('03:07')
  })

  it('availableFromMs가 없거나 0이면 자막 시각 그대로다', () => {
    const caption = captionView({ startMs: 194_000, synced: true, at: '03:14' })
    expect(captionDisplayLabel(caption, null)).toBe('03:14')
    expect(captionDisplayLabel(caption, 0)).toBe('03:14')
  })

  it('세션 축이 아닌 fallback 자막은 변환하지 않는다', () => {
    // stream-local 값에서 세션 축 간격을 빼면 의미 없는 숫자가 된다.
    const caption = captionView({ startMs: 194_000, synced: false, at: '03:14' })
    expect(captionDisplayLabel(caption, 7_000)).toBe('03:14')
  })

  it('녹화 시작보다 이른 자막은 0으로 눌러 음수를 만들지 않는다', () => {
    const caption = captionView({ startMs: 3_000, synced: true, at: '00:03' })
    expect(captionDisplayLabel(caption, 7_000)).toBe('00:00')
  })
})

describe('재생 위치 기준 자막 노출 선택 (selectVisibleCaptions)', () => {
  const captions: CaptionView[] = [
    captionView({ startMs: 1_000, synced: true }),
    captionView({ startMs: 5_000, synced: true }),
    captionView({ startMs: 20_000, synced: true }),
  ]

  it('재생 위치를 모르는 화면(라이브 강사)은 전부 노출한다(실시간 append)', () => {
    const visible = selectVisibleCaptions(captions, null)
    expect(visible).toHaveLength(3)
  })

  it('재생 위치까지의 자막만 노출하고 앞선 자막은 감춘다', () => {
    // positionMs=5_000, STT 지연 보정 1_500 → 6_500 이하만. 20_000은 아직 앞서 있어 감춘다.
    const visible = selectVisibleCaptions(captions, 5_000)
    expect(visible.map((caption) => caption.startMs)).toEqual([1_000, 5_000])
  })

  it('위치 축이 아닌 fallback 자막(synced=false)은 위치를 앞서도 그대로 노출한다', () => {
    // 위치=0. synced 자막(20_000)은 위치를 앞서 감춰지지만, 위치 축이 아닌 fallback은 판단 불가라 노출된다.
    const mixed: CaptionView[] = [
      captionView({ startMs: 20_000, synced: true }),
      captionView({ startMs: 20_000, synced: false }),
    ]
    const visible = selectVisibleCaptions(mixed, 0)
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
    expect(selectVisibleCaptions([clicked], positionMs)).toEqual([clicked])
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
