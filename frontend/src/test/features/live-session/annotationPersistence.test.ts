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
