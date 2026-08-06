import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import PersonalAiQuestionPanel from '@/features/ai/PersonalAiQuestionPanel'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import type { LearningPanel } from '@/features/live-session/liveLearningPreview'
import type { AskAiAnswer } from '@/features/ai/PersonalAiQuestionPanel'
import type { ChatMessageView } from '@/features/live-session/liveSessionService.interface'

/**
 * 탭을 옮겨도 <b>패널 안의 상태가 살아 있어야 한다</b>.
 *
 * <p>예전에는 활성 탭만 그려서(`{panel === 'ai' && …}`) 탭을 옮기는 순간 패널이 언마운트됐고,
 * AI 대화·진행 중이던 스트림·용어집 검색어·쓰다 만 입력이 통째로 사라졌다. 특히 방금 받은 AI
 * 답변은 서버 기록 조회에 아직 없어서, 돌아오면 없어진 것처럼 보였다.
 */
const messages: ChatMessageView[] = [
  { id: 'm1', alias: '수강생', text: '첫 메시지', time: '10:00', question: false },
]

function Harness({ ask }: { ask: AskAiAnswer }) {
  const [panel, setPanel] = useState<LearningPanel>('ai')
  return (
    <LearningSidebar
      panel={panel}
      onPanelChange={setPanel}
      selectedTermId={null}
      onSelectedTermChange={() => undefined}
      glossaryFocusRequest={null}
      lectureNote={null}
      glossaryTerms={[
        { termId: 'SecurityContext', term: 'SecurityContext', description: '설명', source: 'INSTRUCTOR', sourceLabel: '강사 등록', aliases: [], occurrenceCount: 1 },
      ]}
      messages={messages}
      myDisplayName="나"
      aiContent={<PersonalAiQuestionPanel ask={ask} />}
      noteContext="LIVE"
    />
  )
}

const tab = (name: string) => screen.getByRole('tab', { name })

describe('사이드바 탭을 옮겨도', () => {
  it('AI 대화가 남아 있다', async () => {
    const user = userEvent.setup()
    // 답변 하나를 끝까지 흘려 보낸다.
    const ask: AskAiAnswer = async (_question, { onEvent }) => {
      onEvent({ type: 'answer.delta', payload: { requestId: 'r-1', text: 'RAG는 검색 증강입니다.' } })
      onEvent({ type: 'answer.done', payload: { requestId: 'r-1', sources: [] } })
    }
    render(<Harness ask={ask} />)

    await user.type(screen.getByRole('textbox', { name: 'AI에게 할 질문' }), 'RAG가 뭐야?')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/RAG는 검색 증강입니다/)).toBeInTheDocument()

    // 다른 탭에 갔다 돌아온다 — 예전에는 여기서 대화가 사라졌다.
    await user.click(tab('핵심 용어'))
    await user.click(tab('AI 질문'))

    expect(screen.getByText(/RAG는 검색 증강입니다/)).toBeInTheDocument()
    expect(screen.getByText('RAG가 뭐야?')).toBeInTheDocument()
  })

  it('쓰다 만 질문이 남아 있다', async () => {
    const user = userEvent.setup()
    render(<Harness ask={async () => undefined} />)

    await user.type(screen.getByRole('textbox', { name: 'AI에게 할 질문' }), '아직 안 보낸 질문')
    await user.click(tab('채팅'))
    await user.click(tab('AI 질문'))

    expect(screen.getByRole('textbox', { name: 'AI에게 할 질문' })).toHaveValue('아직 안 보낸 질문')
  })

  it('용어집 검색어가 남아 있다', async () => {
    const user = userEvent.setup()
    render(<Harness ask={async () => undefined} />)

    await user.click(tab('핵심 용어'))
    await user.type(screen.getByRole('textbox', { name: '핵심 용어 검색' }), 'Security')
    await user.click(tab('AI 질문'))
    await user.click(tab('핵심 용어'))

    expect(screen.getByRole('textbox', { name: '핵심 용어 검색' })).toHaveValue('Security')
  })

  it('활성 탭만 보이고 나머지는 감춰진다', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness ask={async () => undefined} />)

    await user.click(tab('핵심 용어'))
    await waitFor(() => expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(2))

    const panels = [...container.querySelectorAll('[role="tabpanel"]')]
    // 살아는 있되 하나만 보인다 — 둘 다 보이면 화면에 패널이 겹쳐 나온다.
    expect(panels.filter((p) => !p.hasAttribute('hidden')).length).toBe(1)
    expect(panels.filter((p) => p.hasAttribute('hidden')).length).toBe(1)
  })

  it('열지 않은 탭은 아예 그리지 않는다', () => {
    // 노트 패널은 Markdown 렌더러를 지연 로드한다 — 열지도 않은 탭 때문에 그 청크를 받으면 안 된다.
    const { container } = render(<Harness ask={async () => undefined} />)

    expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(1)
    expect(container.querySelector('[role="tabpanel"]')?.id).toContain('ai')
  })
})
