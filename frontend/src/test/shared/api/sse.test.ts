import { describe, expect, it } from 'vitest'
import { createSseDecoder } from '@/shared/api/sse'

/**
 * SSE 프레임 경계 파싱.
 *
 * 여기서 지키려는 것은 하나다 — **네트워크 청크는 프레임 경계와 무관하게 쪼개진다.** 한 줄이 두 청크에
 * 걸치거나 CRLF 사이가 갈라져도 이벤트 수가 달라지면 안 된다. 라이브 AI 답변은 델타를 이어 붙여
 * 렌더하므로, 프레임을 하나 놓치면 답변에서 문장이 통째로 빠진다.
 */
describe('SSE 프레임 디코더', () => {
  it('event·data를 잘라 내고 빈 줄에서 프레임을 끊는다', () => {
    const decoder = createSseDecoder()

    const frames = decoder.push('event: answer.delta\ndata: {"text":"안"}\n\nevent: answer.delta\ndata: {"text":"녕"}\n\n')

    expect(frames).toEqual([
      { event: 'answer.delta', data: '{"text":"안"}' },
      { event: 'answer.delta', data: '{"text":"녕"}' },
    ])
  })

  it('한 줄이 여러 청크에 걸쳐 와도 프레임 하나로 모은다', () => {
    const decoder = createSseDecoder()

    expect(decoder.push('event: answer.d')).toEqual([])
    expect(decoder.push('elta\ndata: {"te')).toEqual([])
    expect(decoder.push('xt":"이어붙는다"}\n')).toEqual([])
    expect(decoder.push('\n')).toEqual([
      { event: 'answer.delta', data: '{"text":"이어붙는다"}' },
    ])
  })

  it('CRLF가 청크 경계에서 갈려도 빈 줄을 하나로 센다', () => {
    const decoder = createSseDecoder()

    // 청크가 CR로 끝나고 다음 청크가 LF로 시작한다 — CR을 바로 개행으로 접으면 빈 줄이 하나 더 생겨
    // 프레임이 잘못 끊긴다.
    expect(decoder.push('event: answer.done\r\ndata: {"sources":[]}\r')).toEqual([])
    expect(decoder.push('\n\r\n')).toEqual([
      { event: 'answer.done', data: '{"sources":[]}' },
    ])
  })

  it('주석 줄은 버리고, data가 여러 줄이면 개행으로 잇는다', () => {
    const decoder = createSseDecoder()

    const frames = decoder.push(': keep-alive\nevent: answer.delta\ndata: 첫 줄\ndata: 둘째 줄\n\n')

    expect(frames).toEqual([{ event: 'answer.delta', data: '첫 줄\n둘째 줄' }])
  })

  it('event 없이 온 프레임은 SSE 기본값 message가 되고, 빈 줄 없이 끝난 프레임은 flush로 회수한다', () => {
    const decoder = createSseDecoder()

    expect(decoder.push('data: 마지막 조각\n')).toEqual([])
    expect(decoder.flush()).toEqual([{ event: 'message', data: '마지막 조각' }])
    // 회수한 프레임을 두 번 주지 않는다.
    expect(decoder.flush()).toEqual([])
  })
})
