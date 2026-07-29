import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'

// 이 파일은 HTTP 구현체의 계약을 본다 — 목 데이터 소스를 강제하는 테스트 기본값을 끄고 fetch를 세운다.
vi.mock('@/shared/config/runtime', () => ({
  isMockApiEnabled: false,
  isTestMode: false,
  isNetworkBlocked: false,
}))

import { apiClient } from '@/shared/api/client'
import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'
import type { AiAnswerStreamEvent } from '@/features/live-session/liveSessionService.interface'

/** 청크 배열을 그대로 흘리는 최소 Response. 실제 스트림처럼 프레임 경계와 어긋나게 쪼개 넣는다. */
function streamingResponse(chunks: string[], hooks: { onCancel?: () => void } = {}) {
  const encoder = new TextEncoder()
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined },
        cancel: async () => { hooks.onCancel?.() },
      }),
    },
  } as unknown as Response
}

function errorResponse(status: number, payload: unknown) {
  return {
    ok: false,
    status,
    json: async () => payload,
  } as unknown as Response
}

function frame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const collect = () => {
  const events: AiAnswerStreamEvent[] = []
  return { events, onEvent: (event: AiAnswerStreamEvent) => void events.push(event) }
}

describe('라이브 AI 답변 SSE 계약', () => {
  beforeEach(() => {
    // CSRF는 공용 axios 캐시를 그대로 쓴다 — fetch가 별도 토큰을 만들면 두 벌이 된다.
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { token: 'csrf-1', headerName: 'X-XSRF-TOKEN' } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('세션 스코프 /stream 경로로 question 하나만 담아 POST한다', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(streamingResponse([frame('answer.done', { requestId: 'r1', sources: [] })]))
    vi.stubGlobal('fetch', fetchSpy)
    const { onEvent } = collect()

    await httpLiveSessionService.askLiveAi('ses-1', '  질문 본문  ', { onEvent })

    const [url, init] = fetchSpy.mock.calls[0]
    // 경로가 `/stream`으로 끝나는 것은 계약이다 — 운영 nginx가 이 형태에만 proxy_buffering off를 건다.
    expect(url).toBe('/api/live-sessions/ses-1/ai/answers/stream')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toMatchObject({
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': 'csrf-1',
    })
    // lessonId·contextTimeMs·requestId는 서버가 채운다. 클라가 보내면 다른 강의 근거를 열람할 여지가 생긴다.
    expect(JSON.parse(init.body)).toEqual({ question: '  질문 본문  ' })
  })

  it('델타를 순서대로 넘기고 answer.done의 근거를 원본 좌표 그대로 준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse([
      // 프레임 경계와 어긋나게 쪼갠다.
      'event: answer.delta\ndata: {"requestId":"r1","text":"Securi',
      'tyContext는 "}\n\nevent: answer.delta\ndata: {"requestId":"r1","text":"인증 주체를 보관합니다."}\n\n',
      frame('answer.done', {
        requestId: 'r1',
        sources: [
          { type: 'PPTX', materialId: 'mat-1', page: 4 },
          { type: 'CAPTION', sessionId: 'ses-1', sttSessionId: 'stt-2', startMs: 55_000, endMs: 59_000 },
          // 모르는 근거 종류가 섞여 와도 답변이 깨지지 않는다(프록시가 ai-api 스키마를 그대로 흘린다).
          { type: 'FUTURE', foo: 'bar' },
        ],
      }),
    ])))
    const { events, onEvent } = collect()

    await httpLiveSessionService.askLiveAi('ses-1', '질문', { onEvent })

    expect(events.map((event) => event.type)).toEqual(['answer.delta', 'answer.delta', 'answer.done'])
    expect(events.slice(0, 2).map((event) => (event as { payload: { text: string } }).payload.text).join(''))
      .toBe('SecurityContext는 인증 주체를 보관합니다.')
    expect(events[2]).toEqual({
      type: 'answer.done',
      payload: {
        requestId: 'r1',
        sources: [
          { type: 'PPTX', materialId: 'mat-1', page: 4 },
          { type: 'CAPTION', sessionId: 'ses-1', sttSessionId: 'stt-2', startMs: 55_000, endMs: 59_000 },
        ],
      },
    })
  })

  it('answer.insufficient와 answer.error는 그대로 통과한다(오류로 던지지 않는다)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(streamingResponse([frame('answer.insufficient', { requestId: 'r1', message: '근거 없음' })]))
      .mockResolvedValueOnce(streamingResponse([
        frame('answer.delta', { requestId: 'r2', text: '앞부분' }),
        frame('answer.error', { requestId: 'r2', code: 'PROXY_STREAM_INCOMPLETE', message: '중계가 끊겼습니다', retryable: true }),
      ])))

    const insufficient = collect()
    await httpLiveSessionService.askLiveAi('ses-1', '점심 뭐예요', { onEvent: insufficient.onEvent })
    expect(insufficient.events).toEqual([
      { type: 'answer.insufficient', payload: { requestId: 'r1', message: '근거 없음' } },
    ])

    // 스트림이 시작된 뒤의 실패는 HTTP 상태가 아니라 answer.error로 온다 — 화면 분기가 하나다.
    const failed = collect()
    await httpLiveSessionService.askLiveAi('ses-1', '질문', { onEvent: failed.onEvent })
    expect(failed.events[1]).toEqual({
      type: 'answer.error',
      payload: { requestId: 'r2', code: 'PROXY_STREAM_INCOMPLETE', message: '중계가 끊겼습니다', retryable: true },
    })
  })

  it.each([
    [403, 'LIVE_SESSION_FORBIDDEN'],
    [409, 'AI_ANSWER_REQUEST_CONFLICT'],
    [503, 'AI_ANSWER_UNAVAILABLE'],
  ])('스트림 시작 전 %s 실패는 code를 실은 ApiError로 던진다', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(status, { code, message: '실패', correlationId: 'cid-1' })))
    const { events, onEvent } = collect()

    await expect(httpLiveSessionService.askLiveAi('ses-1', '질문', { onEvent }))
      .rejects.toMatchObject({ status, code, correlationId: 'cid-1' })
    expect(events).toEqual([])
  })

  it('오류 봉투가 없는 실패도 상태코드를 실은 ApiError가 된다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error('본문 없음') },
    } as unknown as Response))
    const { onEvent } = collect()

    await expect(httpLiveSessionService.askLiveAi('ses-1', '질문', { onEvent }))
      .rejects.toMatchObject({ status: 502 })
  })

  it('중단하면 오류가 아니라 조용히 끝나고 남은 바디를 취소한다', async () => {
    const controller = new AbortController()
    const onCancel = vi.fn()
    const encoder = new TextEncoder()
    let served = false
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (!served) {
              served = true
              return { done: false, value: encoder.encode(frame('answer.delta', { requestId: 'r1', text: '앞부분' })) }
            }
            // 실제 fetch는 abort 시 AbortError로 read를 깬다.
            await new Promise((resolve) => setTimeout(resolve, 0))
            const abortError = new Error('aborted')
            abortError.name = 'AbortError'
            throw abortError
          },
          cancel: async () => { onCancel() },
        }),
      },
    } as unknown as Response))
    const { events, onEvent } = collect()

    const pending = httpLiveSessionService.askLiveAi('ses-1', '질문', { onEvent, signal: controller.signal })
    controller.abort()

    // 취소는 사용자가 방금 한 행동이다 — 오류로 올리면 화면이 재시도 버튼을 띄운다.
    await expect(pending).resolves.toBeUndefined()
    expect(events).toEqual([{ type: 'answer.delta', payload: { requestId: 'r1', text: '앞부분' } }])
    // 남은 바디를 버려야 서버 릴레이(=ai-api 연결)까지 정리된다.
    expect(onCancel).toHaveBeenCalled()
  })

  it('요청 자체가 나가지 못하면 재시도 가능한 code로 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { onEvent } = collect()

    await expect(httpLiveSessionService.askLiveAi('ses-1', '질문', { onEvent }))
      .rejects.toMatchObject({ code: 'AI_ANSWER_NETWORK_FAILED' })
  })

  it('던지는 오류는 화면이 분기하는 ApiError 타입이다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(404, { code: 'LIVE_SESSION_NOT_FOUND', message: '없음' })))
    const { onEvent } = collect()

    await expect(httpLiveSessionService.askLiveAi('ses-1', '질문', { onEvent })).rejects.toBeInstanceOf(ApiError)
  })
})
