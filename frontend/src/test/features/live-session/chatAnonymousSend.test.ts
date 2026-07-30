import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'

/**
 * 채팅 익명 전송 계약(ADR-0050). 익명은 발신자 선택이며 **켰을 때만** 세션 한정 가명이 된다 —
 * 예전에는 서버가 학생을 무조건 익명 처리해 본인이 지정한 표시 이름이 채팅에 나올 수 없었다.
 * 그 회귀를 막으려면 `anonymous`가 실제로 와이어에 실리는지를 고정해야 한다(플래그가 빠지면
 * 서버 기본값으로 조용히 되돌아가고 화면만 보고는 알 수 없다).
 */
describe('채팅 전송 payload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubPost() {
    return vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        messageId: 'msg-1',
        clientMessageId: 'local-1',
        alias: '김학생',
        text: '안녕하세요',
        isQuestion: false,
        mine: true,
        createdAt: '2026-07-30T03:00:00.000Z',
        sessionMs: 1000,
      },
    } as never)
  }

  it('익명을 켜면 anonymous=true로 보낸다', async () => {
    const post = stubPost()

    await httpLiveSessionService.sendChatMessage('ses-1', {
      clientMessageId: 'local-1',
      text: '안녕하세요',
      question: false,
      anonymous: true,
    })

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body] = post.mock.calls[0]
    expect(url).toBe('/live-sessions/ses-1/messages')
    expect(body).toMatchObject({ clientMessageId: 'local-1', text: '안녕하세요', anonymous: true })
  })

  it('익명을 끄면 anonymous=false로 보낸다 — 생략해서 서버 기본값에 맡기지 않는다', async () => {
    const post = stubPost()

    await httpLiveSessionService.sendChatMessage('ses-1', {
      clientMessageId: 'local-2',
      text: '이름 보이게',
      question: false,
      anonymous: false,
    })

    const [, body] = post.mock.calls[0]
    expect(body).toMatchObject({ anonymous: false })
    expect(Object.keys(body as object)).toContain('anonymous')
  })

  it('호출자가 만든 clientMessageId를 그대로 보낸다 — 낙관적 항목과 응답을 잇는 키다', async () => {
    const post = stubPost()

    await httpLiveSessionService.sendChatMessage('ses-1', {
      clientMessageId: 'local-fixed-id',
      text: '키 유지',
      question: true,
      anonymous: false,
    })

    const [, body] = post.mock.calls[0]
    expect(body).toMatchObject({ clientMessageId: 'local-fixed-id', isQuestion: true })
  })

  it('전송 응답은 항상 내 메시지다(mine=true) — 우측 정렬이 응답 필드 유무에 흔들리지 않는다', async () => {
    stubPost()

    const sent = await httpLiveSessionService.sendChatMessage('ses-1', {
      clientMessageId: 'local-3',
      text: '내 것',
      question: false,
      anonymous: false,
    })

    expect(sent.mine).toBe(true)
    // clientMessageId는 서버가 되돌려준 값을 쓴다(스텁은 'local-1'을 반향) — 입력을 그대로
    // 재사용하지 않는다. 서버가 멱등 처리로 기존 메시지를 돌려줄 수 있기 때문이다.
    expect(sent.clientMessageId).toBe('local-1')
  })
})
