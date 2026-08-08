import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { apiClient } from '@/shared/api/client'
import type { CaptionStreamEvent } from '@/features/live-session/liveSessionService.interface'

const stompHarness = vi.hoisted(() => ({ clients: [] as unknown[] }))

vi.mock('@stomp/stompjs', () => ({
  Client: class StompClientDouble {
    config: Record<string, unknown>
    onConnect = vi.fn()
    onStompError = vi.fn()
    onWebSocketClose = vi.fn()
    onWebSocketError = vi.fn()
    activate = vi.fn()
    deactivate = vi.fn().mockResolvedValue(undefined)
    subscribe = vi.fn()

    constructor(config: Record<string, unknown>) {
      this.config = config
      stompHarness.clients.push(this)
    }
  },
}))

import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'

interface StompClientDouble {
  config: { brokerURL: string; reconnectDelay: number }
  onConnect: () => void
  activate: Mock
  deactivate: Mock
  subscribe: Mock
}

describe('라이브 자막 STOMP 구독 계약', () => {
  beforeEach(() => {
    stompHarness.clients.length = 0
  })

  it('같은 출처의 WS 엔드포인트와 세션 자막 토픽을 구독하고 델타/종료 이벤트만 넘긴다', () => {
    const onEvent = vi.fn<(event: CaptionStreamEvent) => void>()
    const onConnectionChange = vi.fn()
    const unsubscribe = httpLiveSessionService.subscribeCaptions('ses-live-1', onEvent, onConnectionChange)
    const client = stompHarness.clients[0] as StompClientDouble

    expect(client.config.brokerURL).toMatch(/^ws:\/\/.*\/api\/ws$/)
    expect(client.config.reconnectDelay).toBe(3_000)
    expect(client.activate).toHaveBeenCalledOnce()
    expect(onConnectionChange).toHaveBeenLastCalledWith('connecting')

    client.onConnect()
    expect(onConnectionChange).toHaveBeenLastCalledWith('connected')
    expect(client.subscribe).toHaveBeenCalledWith(
      '/topic/live-sessions/ses-live-1/captions',
      expect.any(Function),
    )

    const receive = client.subscribe.mock.calls[0][1] as (frame: { body: string }) => void

    // delta: raw streamElapsedMs 그대로 + 근사 sessionMs(ADR-0045) + 앵커 anchoredSessionMs(ADR-0104) 통과.
    receive({
      body: JSON.stringify({
        eventId: 'evt-1',
        type: 'caption.delta',
        sessionId: 'ses-live-1',
        occurredAt: '2026-07-29T10:00:00+09:00',
        payload: {
          contractVersion: '1',
          lessonId: 'lesson-1',
          sttSessionId: 'stt-1',
          sequence: 3,
          streamElapsedMs: 42_000,
          sessionMs: 41_000,
          anchoredSessionMs: 40_500,
          text: '자막 조각',
        },
      }),
    })
    expect(onEvent).toHaveBeenLastCalledWith({
      type: 'caption.delta',
      occurredAt: '2026-07-29T10:00:00+09:00',
      payload: {
        sttSessionId: 'stt-1',
        sequence: 3,
        streamElapsedMs: 42_000,
        sessionMs: 41_000,
        anchoredSessionMs: 40_500,
        text: '자막 조각',
      },
    })

    // completed: 종료 마커. 서버가 두 시각을 안 주면(clockOriginAt·앵커 전) 각각 null로 정규화한다.
    receive({
      body: JSON.stringify({
        eventId: 'evt-2',
        type: 'caption.stream.completed',
        sessionId: 'ses-live-1',
        occurredAt: '2026-07-29T10:01:00+09:00',
        payload: { sttSessionId: 'stt-1', lastSequence: 3, reason: 'ROOM_DELETED' },
      }),
    })
    expect(onEvent).toHaveBeenLastCalledWith({
      type: 'caption.stream.completed',
      occurredAt: '2026-07-29T10:01:00+09:00',
      payload: {
        sttSessionId: 'stt-1',
        lastSequence: 3,
        sessionMs: null,
        anchoredSessionMs: null,
        reason: 'ROOM_DELETED',
      },
    })

    // segment.final: 확정 세그먼트 경계. raw start/end streamElapsedMs 그대로 통과, sessionMs 없으면 null.
    receive({
      body: JSON.stringify({
        eventId: 'evt-3',
        type: 'caption.segment.final',
        sessionId: 'ses-live-1',
        occurredAt: '2026-07-29T10:02:00+09:00',
        payload: {
          contractVersion: '1',
          sttSessionId: 'stt-1',
          segmentIndex: 0,
          lastSequence: 3,
          text: '인증이 끝나면 SecurityContext가 남는다.',
          startStreamElapsedMs: 40_000,
          endStreamElapsedMs: 44_000,
          boundaryReason: 'SILENCE',
        },
      }),
    })
    expect(onEvent).toHaveBeenLastCalledWith({
      type: 'caption.segment.final',
      occurredAt: '2026-07-29T10:02:00+09:00',
      payload: {
        sttSessionId: 'stt-1',
        segmentIndex: 0,
        lastSequence: 3,
        text: '인증이 끝나면 SecurityContext가 남는다.',
        startStreamElapsedMs: 40_000,
        endStreamElapsedMs: 44_000,
        boundaryReason: 'SILENCE',
        sessionMs: null,
        anchoredSessionMs: null,
      },
    })

    // 다른 세션·미지의 type은 무시한다.
    onEvent.mockClear()
    receive({ body: JSON.stringify({ type: 'caption.delta', sessionId: 'other', occurredAt: 'x', payload: {} }) })
    receive({ body: JSON.stringify({ type: 'caption.unknown', sessionId: 'ses-live-1', occurredAt: 'x', payload: {} }) })
    expect(onEvent).not.toHaveBeenCalled()

    unsubscribe()
    expect(onConnectionChange).toHaveBeenLastCalledWith('disconnected')
    expect(client.deactivate).toHaveBeenCalledOnce()
  })
})

describe('저장된 자막 리로드(getCaptions) 매핑', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('리로드 응답의 caption.segment.final 항목을 세그먼트 스트림 이벤트로 옮긴다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: [
        {
          type: 'caption.delta',
          sttSessionId: 'stt-1',
          sequence: 1,
          lastSequence: null,
          streamElapsedMs: 40_000,
          sessionMs: null,
          text: '인증이 끝나면 ',
          reason: null,
          occurredAt: '2026-07-29T10:00:00+09:00',
          segmentIndex: null,
          startStreamElapsedMs: null,
          endStreamElapsedMs: null,
          boundaryReason: null,
        },
        {
          type: 'caption.segment.final',
          sttSessionId: 'stt-1',
          sequence: null,
          lastSequence: 1,
          streamElapsedMs: 40_000,
          sessionMs: 39_000,
          text: '인증이 끝나면 SecurityContext가 남는다.',
          reason: null,
          occurredAt: '2026-07-29T10:00:05+09:00',
          segmentIndex: 0,
          startStreamElapsedMs: 40_000,
          endStreamElapsedMs: 44_000,
          boundaryReason: 'SILENCE',
        },
      ],
    } as never)

    const events = await httpLiveSessionService.getCaptions('ses-live-1')

    expect(apiClient.get).toHaveBeenCalledWith('/live-sessions/ses-live-1/captions')
    expect(events).toEqual([
      {
        type: 'caption.delta',
        occurredAt: '2026-07-29T10:00:00+09:00',
        payload: {
          sttSessionId: 'stt-1',
          sequence: 1,
          streamElapsedMs: 40_000,
          sessionMs: null,
          anchoredSessionMs: null,
          text: '인증이 끝나면 ',
        },
      },
      {
        type: 'caption.segment.final',
        occurredAt: '2026-07-29T10:00:05+09:00',
        payload: {
          sttSessionId: 'stt-1',
          segmentIndex: 0,
          lastSequence: 1,
          text: '인증이 끝나면 SecurityContext가 남는다.',
          startStreamElapsedMs: 40_000,
          endStreamElapsedMs: 44_000,
          boundaryReason: 'SILENCE',
          sessionMs: 39_000,
          anchoredSessionMs: null,
        },
      },
    ])
  })
})
