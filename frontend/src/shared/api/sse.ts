/**
 * SSE(`text/event-stream`) 프레임 디코더.
 *
 * `EventSource`는 GET만 지원한다. 라이브 AI 답변은 `POST`라(ADR-0047 §1) `fetch` + `ReadableStream`으로
 * 직접 읽어야 하고, 그러면 프레임 경계를 우리가 잘라야 한다. 네트워크 청크는 프레임/줄 경계와 무관하게
 * 쪼개져 오므로(한 줄이 두 청크에 걸치는 것이 정상이다) 디코더가 남은 조각을 들고 있는다.
 *
 * 파싱 범위는 [WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html)의
 * `event`·`data` 두 필드다. `id`·`retry`는 이 스트림에서 쓰지 않는다 — 재연결·이어받기가 없고
 * (끊기면 새 requestId로 다시 질문한다, ADR-0047 "결과"), 주석 줄(`:`)은 버린다.
 */
export interface SseFrame {
  /** `event:` 필드값. 없으면 SSE 기본값 `message`. */
  event: string
  /** `data:` 줄들을 개행으로 이어 붙인 값. */
  data: string
}

export interface SseDecoder {
  /** 도착한 텍스트 청크를 넣고, 이번에 완성된 프레임들을 받는다. */
  push: (chunk: string) => SseFrame[]
  /** 스트림이 끝났을 때 빈 줄 없이 남은 마지막 프레임을 회수한다. */
  flush: () => SseFrame[]
}

export function createSseDecoder(): SseDecoder {
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []
  const frames: SseFrame[] = []

  // 빈 줄 = 프레임 경계. data가 하나도 없으면 프레임이 아니다(주석·헤더성 줄만 있던 경우).
  function dispatch() {
    if (dataLines.length > 0) frames.push({ event: eventName || 'message', data: dataLines.join('\n') })
    eventName = ''
    dataLines = []
  }

  function consumeLine(line: string) {
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const rawValue = separator < 0 ? '' : line.slice(separator + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
  }

  return {
    push(chunk) {
      buffer += chunk
      // 청크 경계가 CRLF 사이에 떨어질 수 있다. 끝의 CR을 지금 개행으로 접으면 다음 청크의 LF가
      // 빈 줄로 보여 프레임이 하나 더 끊긴다 — 그래서 CR은 다음 청크까지 보류한다.
      const pendingCr = buffer.endsWith('\r')
      const lines = (pendingCr ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n').split('\n')
      buffer = `${lines.pop() ?? ''}${pendingCr ? '\r' : ''}`
      for (const line of lines) consumeLine(line)
      return frames.splice(0)
    },
    flush() {
      if (buffer) {
        consumeLine(buffer.replace(/\r$/, ''))
        buffer = ''
      }
      dispatch()
      return frames.splice(0)
    },
  }
}
