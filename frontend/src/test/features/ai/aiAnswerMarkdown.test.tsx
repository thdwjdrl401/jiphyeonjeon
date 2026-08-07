import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import AiChatTurn from '@/features/ai/AiChatTurn'
import type { AiConversationTurn } from '@/features/ai/aiConversation'

/**
 * AI 답변은 <b>Markdown으로 온다.</b>
 *
 * <p>계약이 `answer.delta.text`의 형식을 정해 두지 않아(`docs/CONTRACT.md` §3-9) 모델이 주는 대로
 * 목록·굵게·표가 섞여 온다. 화면이 평문으로 찍던 동안 `**이것**`이 별표째, `- 항목`이 하이픈째 보였다.
 * 계약 위반이 아니라 <b>화면이 안 그리고 있던 것</b>이다.
 *
 * <p>여기서 지키는 것은 셋이다 — <b>문법이 구조가 되는가</b>, <b>스트리밍 중에도 그리는가</b>,
 * <b>모델이 지어낸 링크·이미지가 살아나지 않는가</b>. 마지막이 제일 중요하다. 답변은 자막과 PPTX에서
 * 만들어지므로 링크가 나온다면 모델이 만들어 낸 것이고, 그것이 클릭 가능한 채로 남으면 학생은 강의가
 * 준 자료로 알고 누른다.
 */
function turn(overrides: Partial<AiConversationTurn> = {}): AiConversationTurn {
  return {
    id: 'turn-1',
    status: 'done',
    question: 'SecurityContext가 무엇인가요?',
    text: '',
    sources: [],
    notice: '',
    code: null,
    retryable: false,
    ...overrides,
  }
}

/**
 * 지연 로드되는 Markdown 렌더러를 <b>미리 데운다.</b> 강의 노트 테스트와 같은 이유다 — 첫 import가
 * Vite 변환까지 포함해 오래 걸리는데, 그 비용을 `findBy*` 안에서 치르면 부하가 걸린 러너에서
 * asyncUtilTimeout(5초)을 넘긴다(`lectureNoteMarkdown.test.tsx` 참고).
 */
beforeAll(async () => {
  await import('@/shared/ui/MarkdownBody')
}, 120_000)

const body = (container: HTMLElement) => container.querySelector('.ai-answer__body')

describe('AI 답변 Markdown', () => {
  it('목록과 굵게·인라인 코드를 문법이 아니라 구조로 그린다', async () => {
    const { container } = render(
      <AiChatTurn turn={turn({ text: '- **SecurityContext**는 `Authentication`을 담는다\n- 필터 체인이 먼저다' })} />,
    )

    await waitFor(() => expect(container.querySelectorAll('li').length).toBe(2))
    expect(body(container)?.querySelector('strong')?.textContent).toBe('SecurityContext')
    expect(body(container)?.querySelector('code')?.textContent).toBe('Authentication')
    // 문법 기호가 글자로 남지 않는다 — 이게 이번 변경 이전의 화면이었다.
    expect(body(container)?.textContent).not.toContain('**')
    expect(body(container)?.textContent).not.toContain('- 필터')
  })

  it('제목과 표도 원문을 노출하지 않는다', async () => {
    // 계약이 형식을 정하지 않으므로 우리가 기대하지 않은 문법도 온다. 와도 원문이 보이면 안 된다.
    const { container } = render(
      <AiChatTurn turn={turn({ text: '## 정리\n\n| 항목 | 설명 |\n| --- | --- |\n| 인증 | 누구인가 |' })} />,
    )

    await waitFor(() => expect(container.querySelector('table')).not.toBeNull())
    expect(screen.getByRole('heading', { name: '정리' })).toBeInTheDocument()
    expect(body(container)?.textContent).not.toContain('---')
    expect(body(container)?.textContent).not.toContain('##')
  })

  /**
   * 스트리밍 중에도 그린다. "끝난 뒤에 한 번에 바꾸기"는 튀는 것을 없애는 게 아니라 다 읽은 문단까지
   * 마지막에 몰아서 재배치한다(ADR-0096).
   */
  it('아직 스트리밍 중이어도 지금까지 온 만큼을 구조로 그린다', async () => {
    const { container } = render(
      <AiChatTurn turn={turn({ status: 'streaming', text: '- 첫 항목\n- 둘째 항' })} />,
    )

    await waitFor(() => expect(container.querySelectorAll('li').length).toBe(2))
    expect(body(container)).toHaveAttribute('aria-busy', 'true')
    // 작성 중 표시는 그대로 남는다.
    expect(screen.getByText(/답변을 작성하고 있습니다/)).toBeInTheDocument()
  })

  it('링크와 이미지는 지우되 글자는 남긴다', async () => {
    // 답변의 근거는 AiEvidenceList가 따로 그린다. 본문 링크는 모델이 지어낸 것이라 눌리면 안 된다.
    const { container } = render(
      <AiChatTurn turn={turn({ text: '자세한 건 [우리 문서](https://evil.example.com/login)를 보세요.\n\n![그림](https://evil.example.com/a.png)' })} />,
    )

    await waitFor(() => expect(body(container)?.textContent).toContain('우리 문서'))
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('img:not([aria-hidden="true"])')).toBeNull()
    // 지웠다고 문장에 구멍이 나면 안 된다.
    expect(body(container)?.textContent).toContain('우리 문서를 보세요')
  })

  it('raw HTML을 그리지 않는다', async () => {
    // rehype-raw를 넣지 않았으므로 태그는 글자로 남는다. 여기서 <b>가 살아나면 raw HTML이 열린 것이다.
    const { container } = render(
      <AiChatTurn turn={turn({ text: '<img src=x onerror="alert(1)"> <b>굵게</b>' })} />,
    )

    await waitFor(() => expect(body(container)?.textContent).toContain('굵게'))
    expect(body(container)?.querySelector('b')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  /**
   * 본문을 live 영역에 두지 않는다. Markdown은 굵게가 닫히거나 표가 서는 순간 그 부분이 통째로 갈려서,
   * live 영역이면 스크린리더가 답변을 처음부터 다시 읽는다. 완성 사실만 한 번 알린다.
   */
  it('스트리밍 중인 본문을 live 영역에 두지 않는다', async () => {
    const { container, rerender } = render(
      <AiChatTurn turn={turn({ status: 'streaming', text: '작성 중인 답변' })} />,
    )

    await waitFor(() => expect(body(container)?.textContent).toContain('작성 중인 답변'))
    expect(body(container)?.closest('[aria-live]')).toBeNull()
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('')

    rerender(<AiChatTurn turn={turn({ status: 'done', text: '작성 중인 답변' })} />)
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('답변이 완성되었습니다.')
  })

  it('내 질문은 Markdown으로 해석하지 않는다', async () => {
    // 학생이 친 `**`는 그 사람이 친 글자다. 답변과 같은 렌더러를 태우면 입력이 임의로 바뀐다.
    const { container } = render(
      <AiChatTurn turn={turn({ question: '**볼드**가 무엇인가요?', text: '설명입니다.' })} />,
    )

    await waitFor(() => expect(body(container)?.textContent).toContain('설명입니다.'))
    expect(screen.getByText('**볼드**가 무엇인가요?')).toBeInTheDocument()
    expect(container.querySelector('.ai-bubble--mine strong')).toBeNull()
  })
})
