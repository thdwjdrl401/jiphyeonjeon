import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnnotationHighlightCapture } from '@/features/live-session/useAnnotationHighlightCapture'
import type { AnnotationElement } from '@/features/live-session/annotation'

/**
 * 강조 저장 확인은 <b>스스로 닫혀야 한다</b>.
 *
 * <p>강사는 강조를 그린 <b>직후에도 계속 그리고 있고</b>, 이 상자가 뜨는 하단 중앙이 정확히 그
 * 자리다. 대답을 요구하는 상자가 붓 아래 눌어붙어 있으면 판서를 방해한다.
 *
 * <p><b>닫힘은 "아니요"다.</b> 이 확인이 잘못된 근거를 막는 유일한 게이트이므로(ADR-0074),
 * 대답하지 않은 것을 승낙으로 읽으면 캡처가 조용히 올라간다.
 */
vi.mock('@/features/live-session/liveSessionService', () => ({
  captureAnnotationHighlight: vi.fn(async () => {}),
}))

const highlight = [{
  id: 'h1',
  customData: { liveclassHighlight: true },
} as unknown as AnnotationElement]

/** 확인 상자만 그리는 최소 화면. 스테이지 전체를 띄우지 않고 이 상호작용만 본다. */
function Harness({ onCaptured }: { onCaptured?: () => void }) {
  const capture = useAnnotationHighlightCapture({
    sessionId: 'ses-1',
    resolveVideo: () => document.createElement('video'),
    onCaptured,
  })
  return (
    <div>
      <button type="button" onClick={() => capture.onHighlightSettled(highlight)}>강조 완료</button>
      <div data-testid="outside">바깥</div>
      {capture.prompt && (
        <div className="annotation-highlight-prompt" role="dialog">
          <strong>{capture.prompt.message}</strong>
          <small>{capture.prompt.detail}</small>
          <button type="button" onClick={capture.prompt.dismiss}>아니요</button>
          <button type="button" onClick={capture.prompt.confirm}>저장</button>
        </div>
      )}
    </div>
  )
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('강조 저장 확인', () => {
  it('무엇을 저장하는지와 누가 보는지를 말한다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: '강조 완료' }))

    // "AI 근거로 남길까요"는 무엇의 근거인지·누가 언제 보는지가 없어 강사에게 뜻이 서지 않았다.
    expect(screen.getByText('이 화면을 AI 답변 자료로 저장할까요?')).toBeInTheDocument()
    expect(screen.getByText(/수강생이 관련 질문을 하면/)).toBeInTheDocument()
  })

  it('버튼 글자에 대상이 들어 있다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: '강조 완료' }))

    // `남기기`·`안 남김`은 대상이 없어 "판서를 지운다"로도 읽혔다.
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '아니요' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '남기기' })).not.toBeInTheDocument()
  })

  it('아니요를 누르면 저장하지 않고 닫힌다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onCaptured = vi.fn()
    render(<Harness onCaptured={onCaptured} />)
    await user.click(screen.getByRole('button', { name: '강조 완료' }))

    await user.click(screen.getByRole('button', { name: '아니요' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onCaptured).not.toHaveBeenCalled()
  })

  /**
   * 대답하지 않은 것을 승낙으로 읽으면 캡처가 조용히 올라간다.
   *
   * <p><b>바깥 클릭·Esc·자동 닫힘은 여기서 시험하지 않는다</b> — 그 규칙은 스테이지가 걸고
   * 이 훅은 상자를 만들 뿐이다. 셋 다 결국 이 `dismiss`를 부르므로, 그것이 저장하지 않는다는 것을
   * 여기서 못 박는다.
   */
  it('닫아도 저장되지 않는다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onCaptured = vi.fn()
    render(<Harness onCaptured={onCaptured} />)
    await user.click(screen.getByRole('button', { name: '강조 완료' }))

    act(() => { screen.getByRole('button', { name: '아니요' }).click() })

    expect(onCaptured).not.toHaveBeenCalled()
  })
})
