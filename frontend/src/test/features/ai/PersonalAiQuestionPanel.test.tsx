import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const composer = () => screen.getByRole('textbox', { name: 'AI에게 할 질문' })

/** 버튼 클릭 경로. Enter 경로는 별도 테스트에서 따로 고정한다. */
const askQuestion = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(composer(), text)
  await user.click(screen.getByRole('button', { name: '전송' }))
}

describe('개인 AI 질문 패널 — 대화형 UX', () => {
  it('전송하면 내 질문이 즉시 목록에 붙고 입력창은 비워진다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await askQuestion(user, 'SecurityContext가 무엇인가요?')

    // 낙관적 표시 — 서버 응답을 기다리지 않고 내 말풍선이 먼저 올라간다.
    expect(screen.getByText('SecurityContext가 무엇인가요?')).toBeInTheDocument()
    expect(composer()).toHaveValue('')
    // 빈 상태(영실)는 대화가 생기면 사라진다.
    expect(screen.queryByAltText('AI 질문 도우미 영실')).not.toBeInTheDocument()
    expect(harness.calls[0].question).toBe('SecurityContext가 무엇인가요?')
  })

  it('Enter로 전송하고 Shift+Enter는 줄바꿈으로 남는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await user.type(composer(), '첫 줄{Shift>}{Enter}{/Shift}둘째 줄')
    // Shift+Enter는 전송이 아니다.
    expect(harness.calls).toHaveLength(0)
    expect(composer()).toHaveValue('첫 줄\n둘째 줄')

    await user.type(composer(), '{Enter}')

    expect(harness.calls.map((call) => call.question)).toEqual(['첫 줄\n둘째 줄'])
    expect(composer()).toHaveValue('')
  })

  it('한글 IME 조합 중 Enter는 전송하지 않는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })
    await user.type(composer(), '안녕하세')

    // 조합 확정 Enter다 — 이걸 전송으로 받으면 미완성 질문이 그대로 나간다.
    fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true })

    expect(harness.calls).toHaveLength(0)
    expect(composer()).toHaveValue('안녕하세')

    // 조합이 끝난 뒤의 Enter는 전송이다.
    fireEvent.keyDown(composer(), { key: 'Enter' })
    await waitFor(() => expect(harness.calls).toHaveLength(1))
    expect(harness.calls[0].question).toBe('안녕하세')
  })

  it('델타를 누적해 그리고, 전송 자리는 중단 버튼으로 바뀐다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await askQuestion(user, '질문')

    // 스트리밍 중에는 전송을 열어 두지 않는다 — 스트림 하나가 끝나기 전에 또 보내면 앞 요청이 버려진다.
    expect(screen.queryByRole('button', { name: '전송' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '답변 중단' })).toBeInTheDocument()
    expect(screen.getByText('답변을 작성하고 있습니다…')).toBeInTheDocument()

    harness.emit({ type: 'answer.delta', payload: { requestId: 'r1', text: 'SecurityContext는 ' } })
    harness.emit({ type: 'answer.delta', payload: { requestId: 'r1', text: '인증 주체를 보관합니다.' } })

    expect(await screen.findByText('SecurityContext는 인증 주체를 보관합니다.')).toBeInTheDocument()
  })

  it('스트리밍 중에는 Enter를 눌러도 질문이 겹치지 않는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })
    await askQuestion(user, '첫 질문')

    await user.type(composer(), '겹친 질문{Enter}')

    expect(harness.calls).toHaveLength(1)
    // 턴은 하나뿐이고, 못 보낸 입력은 그대로 남아 스트림이 끝난 뒤 보낼 수 있다.
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(composer()).toHaveValue('겹친 질문')
  })

  it('여러 턴이 쌓이고 이전 대화가 남는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await askQuestion(user, '첫 질문')
    harness.emit({ type: 'answer.delta', payload: { requestId: 'r1', text: '첫 답변입니다.' } })
    harness.emit({ type: 'answer.done', payload: { requestId: 'r1', sources: [] } })
    harness.calls[0].finish()

    await askQuestion(user, '두 번째 질문')
    harness.emit({ type: 'answer.delta', payload: { requestId: 'r2', text: '두 번째 답변입니다.' } })

    // 이력은 클라이언트 메모리에만 있지만, 적어도 이 화면 안에서는 지워지지 않는다.
    expect(screen.getByText('첫 질문')).toBeInTheDocument()
    expect(screen.getByText('첫 답변입니다.')).toBeInTheDocument()
    expect(screen.getByText('두 번째 질문')).toBeInTheDocument()
    expect(await screen.findByText('두 번째 답변입니다.')).toBeInTheDocument()
    expect(harness.calls).toHaveLength(2)
  })

  it('이력이 서버에 남지 않는다는 것을 입력창에서 밝힌다', () => {
    renderPanel({ ask: controllableAsk().ask })

    // "저장됨"으로 읽히면 안 된다 — AI-HISTORY-01이 없어 새로고침하면 사라진다.
    expect(screen.getByText('대화는 이 화면에서만 유지되며 새로고침하면 사라집니다.')).toBeInTheDocument()
  })

  it('answer.done의 근거는 접힌 토글로 요약되고, 펼치면 표시 전용 목록이 나온다', async () => {
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

    // 답변 아래에 남는 건 "근거 2" 한 줄이다 — 카드를 항상 펼쳐 두면 패널이 근거로 찬다(ADR-0049 §8).
    const evidenceToggle = await screen.findByRole('button', { name: '근거 2' })
    expect(evidenceToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    await user.click(evidenceToggle)

    expect(evidenceToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('12쪽')).toBeVisible()
    expect(screen.getByTitle('mat-csrf')).toBeVisible()
    expect(screen.getByText('12:08–12:41')).toBeVisible()
    expect(screen.getByText(/영상 위치와 다를 수 있어 이동을 제공하지 않습니다/)).toBeVisible()
    // 근거는 표시 전용이다 — 누르면 엉뚱한 지점으로 가므로 버튼으로 만들지 않는다.
    expect(screen.queryByRole('button', { name: /12:08/ })).not.toBeInTheDocument()
    // 정상 종료에는 재시도가 없고, 다시 물어볼 수 있는 상태로 돌아온다.
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송' })).toBeInTheDocument()
  })

  it('근거 펼침은 턴별로 독립이고, 근거가 없는 턴에는 토글이 없다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await askQuestion(user, '첫 질문')
    harness.emit({
      type: 'answer.done',
      payload: { requestId: 'r1', sources: [{ type: 'PPTX', materialId: 'mat-a', page: 3 }] },
    })
    harness.calls[0].finish()

    await askQuestion(user, '두 번째 질문')
    harness.emit({
      type: 'answer.done',
      payload: {
        requestId: 'r2',
        sources: [
          { type: 'PPTX', materialId: 'mat-b', page: 7 },
          { type: 'PPTX', materialId: 'mat-c', page: 9 },
        ],
      },
    })
    harness.calls[1].finish()

    await askQuestion(user, '세 번째 질문')
    harness.emit({ type: 'answer.insufficient', payload: { requestId: 'r3', message: '근거를 찾지 못했습니다.' } })
    harness.calls[2].finish()

    // 근거 0개인 턴은 토글도 만들지 않는다.
    const toggles = await screen.findAllByRole('button', { name: /^근거 \d+$/ })
    expect(toggles.map((button) => button.textContent)).toEqual(['근거 1', '근거 2'])

    await user.click(toggles[1])

    // 두 번째 턴만 열린다 — 대화가 길어져도 나머지는 접힌 채 남는다.
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false')
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('3쪽')).not.toBeVisible()
    expect(screen.getByText('7쪽')).toBeVisible()
    expect(screen.getByText('9쪽')).toBeVisible()
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

  it('스트림 시작 전 실패는 오류로 알리고 같은 질문을 그 자리에서 재시도한다', async () => {
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
    // 재시도는 같은 질문을 그대로 다시 보내고, 질문 말풍선이 하나 더 생기지 않는다.
    expect(ask.mock.calls.map((call) => call[0])).toEqual(['재시도할 질문', '재시도할 질문'])
    expect(screen.getAllByText('재시도할 질문')).toHaveLength(1)
  })

  it('재시도할 수 없는 실패에는 재시도 버튼을 두지 않는다', async () => {
    const user = userEvent.setup()
    const ask = vi.fn<AskAiAnswer>().mockRejectedValue(new ApiError('권한 없음', 403, 'LIVE_SESSION_FORBIDDEN'))
    renderPanel({ ask })

    await askQuestion(user, '질문')

    expect(await screen.findByRole('alert')).toHaveTextContent('수강생만 AI에게 질문할 수 있습니다')
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
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
    // 받은 조각과 질문은 이력에 남고, 다시 물어볼 수 있다.
    expect(screen.getByText('앞부분')).toBeInTheDocument()
    expect(screen.getByText('질문')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송' })).toBeInTheDocument()
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
    expect(composer()).toBeDisabled()
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
  })

  it('공백만 입력하면 보내지 않고, 보낼 때는 앞뒤 공백을 다듬는다', async () => {
    const user = userEvent.setup()
    const harness = controllableAsk()
    renderPanel({ ask: harness.ask })

    await user.type(composer(), '   ')
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
    // Enter로도 빈 질문은 나가지 않는다.
    await user.type(composer(), '{Enter}')
    expect(harness.calls).toHaveLength(0)

    await user.type(composer(), '질문 본문   ')
    await user.click(screen.getByRole('button', { name: '전송' }))

    // 서버가 trim하지 않으므로 FE가 다듬어 보낸다(LIVE.md §10.1).
    expect(harness.calls[0].question).toBe('질문 본문')
  })
})
