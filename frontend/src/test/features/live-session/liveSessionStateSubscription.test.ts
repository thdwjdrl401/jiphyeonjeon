import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LiveSessionStateEvent } from '@/features/live-session/liveSessionService.interface'

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

describe('라이브 세션 상태 STOMP 구독 계약', () => {
  beforeEach(() => {
    stompHarness.clients.length = 0
  })

  it('state 토픽의 ENDING과 ENDED만 화면 상태 이벤트로 넘긴다', () => {
    const onEvent = vi.fn<(event: LiveSessionStateEvent) => void>()
    const onConnectionChange = vi.fn()
    const unsubscribe = httpLiveSessionService.subscribeSessionState(
      'ses-live-1',
      onEvent,
      onConnectionChange,
    )
    const client = stompHarness.clients[0] as StompClientDouble

    expect(client.config.brokerURL).toMatch(/^ws:\/\/.*\/api\/ws$/)
    expect(client.config.reconnectDelay).toBe(3_000)
    expect(client.activate).toHaveBeenCalledOnce()
    expect(onConnectionChange).toHaveBeenLastCalledWith('connecting')

    client.onConnect()
    expect(onConnectionChange).toHaveBeenLastCalledWith('connected')
    expect(client.subscribe).toHaveBeenCalledWith(
      '/topic/live-sessions/ses-live-1/state',
      expect.any(Function),
    )

    const receive = client.subscribe.mock.calls[0][1] as (frame: { body: string }) => void
    receive({
      body: JSON.stringify({
        eventId: 'evt-ending',
        type: 'session.ending',
        sessionId: 'ses-live-1',
        occurredAt: '2026-07-31T15:00:00+09:00',
        payload: { liveSessionStatus: 'ENDING', endedAt: null },
      }),
    })
    receive({
      body: JSON.stringify({
        eventId: 'evt-ended',
        type: 'session.ended',
        sessionId: 'ses-live-1',
        occurredAt: '2026-07-31T15:00:03+09:00',
        payload: {
          liveSessionStatus: 'ENDED',
          endedAt: '2026-07-31T15:00:03+09:00',
        },
      }),
    })

    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      'session.ending',
      'session.ended',
    ])

    receive({
      body: JSON.stringify({
        type: 'session.ended',
        sessionId: 'other-session',
        occurredAt: '2026-07-31T15:00:03+09:00',
        payload: {
          liveSessionStatus: 'ENDED',
          endedAt: '2026-07-31T15:00:03+09:00',
        },
      }),
    })
    expect(onEvent).toHaveBeenCalledTimes(2)

    unsubscribe()
    expect(onConnectionChange).toHaveBeenLastCalledWith('disconnected')
    expect(client.deactivate).toHaveBeenCalledOnce()
  })
})
