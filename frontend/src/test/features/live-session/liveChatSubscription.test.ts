import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

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

describe('라이브 채팅 STOMP 구독 계약', () => {
  beforeEach(() => {
    stompHarness.clients.length = 0
  })

  it('같은 출처의 WS 엔드포인트와 세션 채팅 토픽을 구독하고 메시지를 매핑한다', () => {
    const onMessage = vi.fn()
    const onConnectionChange = vi.fn()
    const unsubscribe = httpLiveSessionService.subscribeChatMessages(
      'ses-live-1',
      onMessage,
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
      '/topic/live-sessions/ses-live-1/chat',
      expect.any(Function),
    )

    const receive = client.subscribe.mock.calls[0][1] as (frame: { body: string }) => void
    receive({
      body: JSON.stringify({
        eventId: 'evt-1',
        type: 'chat.message.created',
        sessionId: 'ses-live-1',
        occurredAt: '2026-07-27T12:00:00+09:00',
        payload: {
          messageId: 'msg-1',
          clientMessageId: 'client-1',
          lessonId: 'lesson-1',
          sessionId: 'ses-live-1',
          sessionMs: 10_000,
          text: '질문이 있습니다.',
          isQuestion: true,
          alias: '수강생-01',
          createdAt: '2026-07-27T12:00:00+09:00',
        },
      }),
    })

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-1',
      alias: '수강생-01',
      text: '질문이 있습니다.',
      question: true,
    }))

    unsubscribe()
    expect(onConnectionChange).toHaveBeenLastCalledWith('disconnected')
    expect(client.deactivate).toHaveBeenCalledOnce()
  })
})
