import { describe, expect, it, vi } from 'vitest'
import type { AnnotationElement, AnnotationOp } from '@/features/live-session/annotation'
import {
  createAnnotationOpSink,
  foldStoredDocument,
  fromApiOp,
  toApiOp,
} from '@/features/live-session/annotationPersistence'

/**
 * 판서 영속화(ADR-0051). 저장이 필요한 이유는 둘이다 — 강사가 새로고침해도 판서가 남아야 하고,
 * 나중에 "강사가 이걸 강조한 순간"으로 다시보기를 이동할 수 있어야 한다.
 *
 * <p>여기서 고정하는 것은 그 둘을 떠받치는 성질이다. <b>복원이 강사가 그린 그대로를 돌려주는 것</b>과,
 * <b>기록 경로의 어떤 실패도 라이브 전달을 막지 않는 것</b>.
 */

function element(id: string, extra: Partial<AnnotationElement> = {}): AnnotationElement {
  return { id, type: 'freedraw', version: 1, ...extra } as AnnotationElement
}

describe('판서 op 직렬화', () => {
  it('type을 opType으로 옮기고 나머지를 payload에 담는다', () => {
    const op: AnnotationOp = { type: 'upsert', revision: 7, elements: [element('a')] }

    const api = toApiOp(op, '2026-07-31T01:00:00.000Z')

    expect(api).toMatchObject({ revision: 7, opType: 'upsert', occurredAt: '2026-07-31T01:00:00.000Z' })
    expect(JSON.parse(api.payload)).toEqual({ elements: [element('a')] })
  })

  it('되돌리면 원래 op가 된다', () => {
    const op: AnnotationOp = { type: 'delete', revision: 3, ids: ['a', 'b'] }

    const restored = fromApiOp(toApiOp(op, '2026-07-31T01:00:00.000Z'))

    expect(restored).toEqual(op)
  })

  /** 저장된 payload가 깨져 있어도 그 op 하나만 버린다. 문서 전체 복원이 실패하면 강의가 빈 판서로 시작한다. */
  it('해석할 수 없는 payload는 null이다', () => {
    expect(fromApiOp({ revision: 1, opType: 'upsert', payload: '{{{' })).toBeNull()
    expect(fromApiOp({ revision: 1, opType: '알수없음', payload: '{}' })).toBeNull()
  })
})

describe('저장된 문서 복원', () => {
  it('스냅샷 위에 그 이후 op를 순서대로 얹는다', () => {
    const restored = foldStoredDocument({
      revision: 12,
      nextRevision: 13,
      snapshotPayload: JSON.stringify({ elements: [element('a'), element('b')] }),
      ops: [
        { revision: 11, opType: 'delete', payload: JSON.stringify({ ids: ['a'] }) },
        { revision: 12, opType: 'upsert', payload: JSON.stringify({ elements: [element('c')] }) },
      ],
    })

    expect(restored.document.elements.map((e) => e.id)).toEqual(['b', 'c'])
    expect(restored.document.revision).toBe(12)
  })

  /**
   * 접힌 문서의 번호로 이어 채번하면 안 된다. 저장에 실패한 op가 있으면 그 번호가 비어, 강사가 이미
   * 쓴 번호를 다시 쓰게 되고 수신 측은 그것을 <b>이미 본 op</b>로 버린다.
   */
  it('이어 쓸 번호는 서버가 준 값을 그대로 쓴다', () => {
    const restored = foldStoredDocument({
      revision: 12,
      nextRevision: 48,
      snapshotPayload: null,
      ops: [{ revision: 12, opType: 'upsert', payload: JSON.stringify({ elements: [element('a')] }) }],
    })

    expect(restored.nextRevision).toBe(48)
  })

  it('저장된 것이 없으면 빈 문서이고 1번부터 채번한다', () => {
    const restored = foldStoredDocument({ revision: 0, nextRevision: 1, snapshotPayload: null, ops: [] })

    expect(restored.document.elements).toEqual([])
    expect(restored.nextRevision).toBe(1)
  })
})

describe('기록 대기열', () => {
  const op = (revision: number): AnnotationOp => ({ type: 'upsert', revision, elements: [element(`e${revision}`)] })

  /** 전송 프라미스 체인(then→catch→finally)이 다 풀릴 때까지. 그래야 다음 flush가 나간다. */
  const settle = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve() }

  it('묶어서 한 번에 보낸다', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const sink = createAnnotationOpSink('s1', { send, flushIntervalMs: 10_000 })

    sink.push(op(1))
    sink.push(op(2))
    expect(send).not.toHaveBeenCalled()   // push는 즉시 보내지 않는다

    sink.flush()
    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1].map((o: { revision: number }) => o.revision)).toEqual([1, 2])
    sink.stop()
  })

  /**
   * `keepalive` 요청은 브라우저가 본문을 64KB로 제한한다(Fetch 표준). 평소 요청까지 켜 두면 판서가
   * 조금만 쌓여도 묶음이 그 한도를 넘어 전송이 통째로 실패하고, 실패한 묶음이 대기열 맨 앞에 다시
   * 들어가 <b>그 뒤로 아무것도 저장되지 않는다</b> — 라이브 전달은 멀쩡하므로 강사는 알 수 없다.
   */
  it('평소에는 keepalive를 쓰지 않는다 — 페이지를 떠날 때만 쓴다', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const sink = createAnnotationOpSink('s1', { send, flushIntervalMs: 10_000 })

    sink.push(op(1))
    sink.flush()
    await settle()
    expect(send.mock.calls[0][2]).toBe(false)

    sink.push(op(2))
    sink.flush(true)
    await settle()
    expect(send.mock.calls[1][2]).toBe(true)

    sink.stop()
  })

  /** 떠나며 보내는 묶음이 64KB를 넘으면 요청이 아예 나가지 않는다. 재시도할 기회도 없다. */
  it('떠날 때 보내는 묶음은 브라우저 한도 아래로 자른다', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const sink = createAnnotationOpSink('s1', { send, flushIntervalMs: 10_000 })

    // 요소 하나가 5KB인 op 30개 = 150KB. 서로 다른 id라 합쳐지지 않는다.
    for (let i = 1; i <= 30; i += 1) {
      sink.push({ type: 'upsert', revision: i, elements: [element(`e${i}`, { text: 'x'.repeat(5_000) })] })
    }

    sink.flush(true)
    await Promise.resolve()

    const body = JSON.stringify(send.mock.calls[0][1])
    expect(body.length).toBeLessThan(64 * 1024)
    expect(sink.pending()).toBeGreaterThan(0)   // 나머지는 대기열에 남는다
    sink.stop()
  })

  /**
   * Excalidraw는 획을 긋는 동안 점이 하나 늘 때마다 `onChange`를 부른다. 획 하나가 수십 개의 op가
   * 되고 뒤로 갈수록 요소 전체가 실려 커진다(실측: 획 하나에 40건, 합쳐서 61KB).
   */
  it('같은 요소를 이어서 고치는 upsert는 마지막 것만 남긴다', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const sink = createAnnotationOpSink('s1', {
      send, flushIntervalMs: 10_000, now: () => new Date('2026-07-31T00:00:00.000Z'),
    })

    sink.push({ type: 'upsert', revision: 1, elements: [element('stroke', { version: 1 })] })
    sink.push({ type: 'upsert', revision: 2, elements: [element('stroke', { version: 2 })] })
    sink.push({ type: 'upsert', revision: 3, elements: [element('stroke', { version: 3 })] })

    expect(sink.pending()).toBe(1)

    sink.flush()
    await Promise.resolve()

    const sent = send.mock.calls[0][1]
    expect(sent).toHaveLength(1)
    expect(sent[0].revision).toBe(3)
    expect(JSON.parse(sent[0].payload).elements[0].version).toBe(3)
    sink.stop()
  })

  /** 다른 요소로 넘어가면 합치지 않는다 — 합치면 앞 획이 사라진다. */
  it('다른 요소의 upsert는 합치지 않는다', () => {
    const sink = createAnnotationOpSink('s1', { send: vi.fn().mockResolvedValue(undefined), flushIntervalMs: 10_000 })

    sink.push({ type: 'upsert', revision: 1, elements: [element('a')] })
    sink.push({ type: 'upsert', revision: 2, elements: [element('b')] })
    sink.push({ type: 'upsert', revision: 3, elements: [element('a')] })

    expect(sink.pending()).toBe(3)
    sink.stop()
  })

  /** 앵커는 "강사가 이걸 그리기 시작한 순간"을 가리켜야 한다. 합칠 때 시각은 처음 것을 남긴다. */
  it('합쳐도 시각은 처음 op의 것을 남긴다', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const times = ['2026-07-31T00:00:01.000Z', '2026-07-31T00:00:02.000Z']
    let call = 0
    const sink = createAnnotationOpSink('s1', {
      send, flushIntervalMs: 10_000, now: () => new Date(times[Math.min(call++, times.length - 1)]),
    })

    sink.push({ type: 'upsert', revision: 1, elements: [element('stroke')] })
    sink.push({ type: 'upsert', revision: 2, elements: [element('stroke')] })

    sink.flush()
    await Promise.resolve()

    expect(send.mock.calls[0][1][0].occurredAt).toBe(times[0])
    sink.stop()
  })

  /**
   * 전송이 실패했다고 버리면 그 획만 빠진 판서가 복원된다. 서버가 같은 revision을 중복 적재하지
   * 않으므로(멱등) 다시 보내는 쪽이 안전하다.
   */
  it('실패한 묶음은 버리지 않고 다시 보낸다', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue(undefined)
    const sink = createAnnotationOpSink('s1', { send, flushIntervalMs: 10_000 })

    sink.push(op(1))
    sink.flush()
    await Promise.resolve()
    await Promise.resolve()

    expect(sink.pending()).toBe(1)

    sink.flush()
    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][1].map((o: { revision: number }) => o.revision)).toEqual([1])
    sink.stop()
  })

  /** 저장은 라이브 경로가 아니다. 여기서 예외가 새면 획을 그리던 호출자가 멈춘다. */
  it('전송이 실패해도 push한 쪽으로 예외가 나가지 않는다', () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'))
    const sink = createAnnotationOpSink('s1', { send, flushIntervalMs: 10_000 })

    expect(() => { sink.push(op(1)); sink.flush() }).not.toThrow()
    sink.stop()
  })
})
