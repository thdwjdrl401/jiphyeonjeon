import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PersonalAiQuestionPanel, { type AskAiAnswer } from '@/features/ai/PersonalAiQuestionPanel'
import { ApiError } from '@/shared/api/client'
import type { AiAnswerStreamEvent, AiAnswerStreamOptions } from '@/features/live-session/liveSessionService'

/** 테스트가 이벤트를 원하는 시점에 흘릴 수 있는 ask 구현. 실제 SSE처럼 델타를 나눠 보낸다. */
function controllableAsk() {
  const calls: Array<{ question: string; options: AiAnswerStreamOptions; finish: () => void }> = []
  const ask: AskAiAnswer = (question, options) => new Promise<void>((resolve) => {
    calls.push({ question, options, finish: resolve })
    options.signal?.addEventListener('abort', () => resolve())
  })
  return {
    ask,
    calls,
    emit(event: AiAnswerStreamEvent, index = calls.length - 1) {
      calls[index].options.onEvent(event)
    },
  }
}

function renderPanel(props: Parameters<typeof PersonalAiQuestionPanel>[0] = {}) {
  return render(<PersonalAiQuestionPanel {...props} />)
}

const askQuestion = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByRole('textbox', { name: 'AI에게 할 질문' }), text)
  await user.click(screen.getByRole('button', { name: '질문하기' }))
}

describe('개인 AI 질문 패널', () => {
  it('델타를 누적해 그리고, 전송 중에는 다시 질문할 수 없다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await askQuestion(user, 'SecurityContext가 무엇인가요?')

    expect(harness.calls[0].question).toBe('SecurityContext가 무엇인가요?')
    // 전송 중에는 버튼이 잠긴다 — 스트림 하나가 끝나기 전에 또 보내면 앞 요청이 버려진다.
    expect(screen.getByRole('button', { name: '답변을 기다리는 중' })).toBeDisabled()

    harness.emit({ type: 'answer.delta', payload: { requestId: 'r1', text: 'SecurityContext는 ' } })
    harness.emit({ type: 'answer.delta', payload: { requestId: 'r1', text: '인증 주체를 보관합니다.' } })

    expect(await screen.findByText('SecurityContext는 인증 주체를 보관합니다.')).toBeInTheDocument()
    expect(screen.getByText('답변을 작성하고 있습니다…')).toBeInTheDocument()
  })

  it('answer.done의 근거를 카드로 그리고, 발화 근거는 축이 달라 이동을 제공하지 않는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })
    await askQuestion(user, '질문')

    harness.emit({
      type: 'answer.done',
      payload: {
        requestId: 'r1',
        sources: [
          { type: 'PPTX', materialId: 'mat-csrf', page: 12 },
          { type: 'CAPTION', sessionId: 'ses-1', sttSessionId: 'stt-2', startMs: 728_000, endMs: 761_000 },
        ],
      },
    })
    harness.calls[0].finish()

    expect(await screen.findByText('12쪽')).toBeInTheDocument()
    expect(screen.getByText('자료 mat-csrf')).toBeInTheDocument()
    expect(screen.getByText('12:08–12:41')).toBeInTheDocument()
    expect(screen.getByText(/영상 위치와 다를 수 있어 이동을 제공하지 않습니다/)).toBeInTheDocument()
    // 근거는 표시 전용이다 — 누르면 엉뚱한 지점으로 가므로 버튼으로 만들지 않는다.
    expect(screen.queryByRole('button', { name: /12:08/ })).not.toBeInTheDocument()
    // 정상 종료에는 재시도가 없다.
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('answer.insufficient는 오류가 아니라 안내로 끝난다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })
    await askQuestion(user, '점심 뭐예요?')

    harness.emit({ type: 'answer.insufficient', payload: { requestId: 'r1', message: '답할 근거를 찾지 못했습니다.' } })
    harness.calls[0].finish()

    expect(await screen.findByText('답할 근거를 찾지 못했습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('스트림 시작 전 실패는 오류로 알리고 같은 질문을 재시도한다', async () => {
    const user = userEvent.setup()
    const ask = vi.fn<AskAiAnswer>()
      .mockRejectedValueOnce(new ApiError('일시 장애', 503, 'AI_ANSWER_UNAVAILABLE'))
      .mockImplementation(async (_question, options) => {
        options.onEvent({ type: 'answer.delta', payload: { requestId: 'r2', text: '두 번째 시도 응답' } })
        options.onEvent({ type: 'answer.done', payload: { requestId: 'r2', sources: [] } })
      })
    renderPanel({ ask })

    await askQuestion(user, '재시도할 질문')

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 답변을 준비하지 못했습니다')

    await user.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByText('두 번째 시도 응답')).toBeInTheDocument()
    // 재시도는 같은 질문을 그대로 다시 보낸다.
    expect(ask.mock.calls.map((call) => call[0])).toEqual(['재시도할 질문', '재시도할 질문'])
  })

  it('terminal 없이 스트림이 끝나면 재시도를 연다', async () => {
    const user = userEvent.setup()
    const ask = vi.fn<AskAiAnswer>().mockImplementation(async (_question, options) => {
      options.onEvent({ type: 'answer.delta', payload: { requestId: 'r1', text: '중간까지만' } })
    })
    renderPanel({ ask })

    await askQuestion(user, '질문')

    expect(await screen.findByRole('alert')).toHaveTextContent('답변이 끝까지 전달되지 않았습니다')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    // 도중까지 받은 본문은 남는다.
    expect(screen.getByText('중간까지만')).toBeInTheDocument()
  })

  it('중단하면 요청에 abort를 보내고 오류로 취급하지 않는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })
    await askQuestion(user, '질문')

    harness.emit({ type: 'answer.delta', payload: { requestId: 'r1', text: '앞부분' } })
    await user.click(screen.getByRole('button', { name: '답변 중단' }))

    await waitFor(() => expect(harness.calls[0].options.signal?.aborted).toBe(true))
    expect(await screen.findByText('답변 생성을 취소했습니다.')).toBeInTheDocument()
    // 취소는 실패가 아니다.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // 다시 물어볼 수 있는 상태로 돌아온다.
    expect(screen.getByRole('button', { name: '질문하기' })).toBeEnabled()
  })

  it('언마운트하면 진행 중이던 요청을 끊는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    const { unmount } = renderPanel({ ask: harness.ask })
    await askQuestion(user, '질문')

    unmount()

    // 끊지 않으면 서버 릴레이와 ai-api 연결이 계속 잡혀 있다.
    expect(harness.calls[0].options.signal?.aborted).toBe(true)
  })

  it('ask가 없으면 미지원 안내를 띄우고 입력을 잠근다', () => {
    renderPanel({ unavailableNotice: '다시보기 AI 질문은 아직 지원하지 않습니다.' })

    // 예전에는 질문을 눌러도 501이 조용히 삼켜져 아무 반응이 없었다.
    expect(screen.getAllByText(/다시보기 AI 질문은 아직 지원하지 않습니다\./).length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: 'AI에게 할 질문' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '질문하기' })).toBeDisabled()
  })

  it('공백만 입력하면 보내지 않고, 보낼 때는 앞뒤 공백을 다듬는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await user.type(screen.getByRole('textbox', { name: 'AI에게 할 질문' }), '   ')
    expect(screen.getByRole('button', { name: '질문하기' })).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'AI에게 할 질문' }), '질문 본문   ')
    await user.click(screen.getByRole('button', { name: '질문하기' }))

    // 서버가 trim하지 않으므로 FE가 다듬어 보낸다(LIVE.md §10.1).
    expect(harness.calls[0].question).toBe('질문 본문')
  })
})
