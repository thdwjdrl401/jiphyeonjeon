import { describe, expect, it } from 'vitest'
import {
  emptyCaptionStreamState,
  reduceCaptionStream,
  selectCaptionViews,
} from '@/features/live-session/captionAdapter'
import type { CaptionStreamEvent } from '@/features/live-session/liveSessionService.interface'

function delta(
  sttSessionId: string,
  sequence: number,
  streamElapsedMs: number,
  text: string,
): CaptionStreamEvent {
  return { type: 'caption.delta', occurredAt: '2026-07-29T10:00:00+09:00', payload: { sttSessionId, sequence, streamElapsedMs, text } }
}

function completed(sttSessionId: string, lastSequence: number): CaptionStreamEvent {
  return { type: 'caption.stream.completed', occurredAt: '2026-07-29T10:00:00+09:00', payload: { sttSessionId, lastSequence, reason: 'ROOM_DELETED' } }
}

function fold(events: CaptionStreamEvent[]) {
  return events.reduce(reduceCaptionStream, emptyCaptionStreamState())
}

describe('라이브 자막 델타 누적', () => {
  it('한 sttSession의 델타를 sequence 순서로 이어 붙여 자라는 한 라인을 만든다', () => {
    const views = selectCaptionViews(fold([
      delta('stt-1', 1, 1_000, '인증이 '),
      delta('stt-1', 2, 2_000, '끝나면 '),
      delta('stt-1', 3, 3_000, 'SecurityContext가 남는다.'),
    ]))

    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      segmentId: 'stt-1',
      text: '인증이 끝나면 SecurityContext가 남는다.',
      startMs: 1_000,
      endMs: 3_000,
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

    expect(views.map((view) => view.segmentId)).toEqual(['stt-a', 'stt-b'])
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
