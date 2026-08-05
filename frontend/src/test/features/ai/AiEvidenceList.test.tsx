import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AiEvidenceList from '@/features/ai/AiEvidenceList'
import type { AiAnswerSource } from '@/features/live-session/liveSessionService'

const PPTX: AiAnswerSource = {
  type: 'PPTX',
  materialId: 'mat-csrf',
  page: 12,
  excerpt: '세션과 CSRF\n쿠키 세션은 브라우저가 자동으로 실어 보낸다.',
}
const CAPTION: AiAnswerSource = {
  type: 'CAPTION',
  sessionId: 'ses-1',
  sttSessionId: 'stt-2',
  startMs: 728_000,
  endMs: 761_000,
  excerpt: '여기서 CSRF 토큰을 왜 따로 두는지 설명드리겠습니다.',
}

const toggle = () => screen.getByRole('button', { name: /근거/ })

/**
 * 근거는 <b>무엇을 근거로 답했는지</b>를 보여 주려고 있다. 예전에는 이 자리에 materialId를 줄여
 * 붙였는데, UUID는 읽는 사람에게 아무 의미가 없어 근거를 보여 주는 뜻 자체가 없었다.
 */
describe('AI 근거 목록 — 발췌문', () => {
  it('UUID가 아니라 서버가 보낸 발췌문을 보여 준다', async () => {
    render(<AiEvidenceList sources={[PPTX]} />)
    await userEvent.click(toggle())

    expect(screen.getByText(/쿠키 세션은 브라우저가 자동으로/)).toBeInTheDocument()
    expect(screen.queryByText(/mat-csrf/)).not.toBeInTheDocument()
  })

  /**
   * 발화(자막) 근거는 <b>감춘다</b>. 자막은 STT 원문이라 오인식이 그대로 근거로 보이고, 답변이 실제로
   * 기댄 것보다 목록을 길게 만든다. 서버·AI는 계속 보내고 화면만 감춘다.
   */
  it('발화 근거는 발췌문이 있어도 보여 주지 않는다', () => {
    const { container } = render(<AiEvidenceList sources={[CAPTION]} />)

    // 자막뿐이면 보여 줄 근거가 하나도 없는 것과 같다 — 토글도 두지 않는다.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/CSRF 토큰을 왜 따로 두는지/)).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  /** 계약상 선택 필드라 옛 답변에는 없다. 그때 UUID를 되살리지 않는다 — 쪽수만 남긴다. */
  it('발췌문이 없으면 쪽수만 남기고 UUID를 되살리지 않는다', async () => {
    render(<AiEvidenceList sources={[{ type: 'PPTX', materialId: 'mat-csrf', page: 12 }]} />)
    await userEvent.click(toggle())

    expect(screen.getByText('12쪽')).toBeInTheDocument()
    expect(screen.queryByText(/mat-csrf/)).not.toBeInTheDocument()
  })
})

/**
 * 근거 표시의 접힘/펼침(ADR-0049 §8).
 *
 * 고정하는 것은 두 축이다 — (1) **기본은 접힘**이라 답변 아래에 한 줄만 남는다(예전에는 카드가 항상
 * 펼쳐져 패널을 근거로 채웠다), (2) 펼쳐도 근거는 여전히 **표시 전용**이다(ADR-0047 §9의 시간축 문제).
 */
describe('AI 근거 목록 — 접힘/펼침', () => {
  it('근거가 있어도 기본은 접혀 있고 개수만 알린다', () => {
    render(<AiEvidenceList sources={[PPTX, { ...PPTX, page: 13 }]} />)

    expect(toggle()).toHaveTextContent('근거 2')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    // 접힌 상태에서는 목록이 접근성 트리에도, 화면에도 없다.
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText('12쪽')).not.toBeVisible()
  })

  /** 감춘 것을 세면 펼쳤을 때 개수와 목록이 어긋난다. */
  it('개수는 보여 줄 근거만 센다 — 감춘 자막은 빼고 센다', async () => {
    const user = userEvent.setup()
    render(<AiEvidenceList sources={[PPTX, CAPTION]} />)

    expect(toggle()).toHaveTextContent('근거 1')

    await user.click(toggle())

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('토글을 누르면 펼쳐지고 다시 누르면 접힌다', async () => {
    const user = userEvent.setup()
    render(<AiEvidenceList sources={[PPTX, { ...PPTX, page: 13 }]} />)

    await user.click(toggle())

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('12쪽')).toBeVisible()
    expect(screen.getByText('13쪽')).toBeVisible()

    await user.click(toggle())

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('토글이 가리키는 패널이 실제로 펼쳐지는 그 영역이다', async () => {
    const user = userEvent.setup()
    render(<AiEvidenceList sources={[PPTX]} />)

    const panelId = toggle().getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    // aria-controls가 없는 노드를 가리키면 스크린리더가 따라갈 대상이 없다.
    const panel = document.getElementById(panelId as string)
    expect(panel).not.toBeNull()
    expect(panel).not.toBeVisible()

    await user.click(toggle())

    expect(panel).toBeVisible()
  })

  it('키보드만으로 열고 닫는다', async () => {
    const user = userEvent.setup()
    render(<AiEvidenceList sources={[PPTX]} />)

    await user.tab()
    expect(toggle()).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard(' ')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('근거가 없으면 토글 자체를 두지 않는다', () => {
    const { container } = render(<AiEvidenceList sources={[]} />)

    // 눌러도 빈 목록만 나오는 버튼은 잡음이다.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * 자막을 감추면서 <b>이동 불가 안내도 함께 사라진다</b> — 그 안내는 자막 근거를 설명하는 문장이라,
   * 보여 주지도 않는 것을 두고 변명하면 읽는 사람만 헷갈린다.
   */
  it('감춘 자막 때문에 이동 불가 안내가 남지 않는다', async () => {
    const user = userEvent.setup()
    render(<AiEvidenceList sources={[PPTX, CAPTION, { ...CAPTION, startMs: 800_000, endMs: 812_000 }]} />)

    await user.click(toggle())

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/12:08/)).not.toBeInTheDocument()
    expect(screen.queryByText(/이동을 제공하지 않습니다/)).not.toBeInTheDocument()
  })

  it('자료 근거만 있으면 이동 불가 안내를 붙이지 않는다', async () => {
    const user = userEvent.setup()
    render(<AiEvidenceList sources={[PPTX]} />)

    await user.click(toggle())

    expect(screen.queryByText(/이동을 제공하지 않습니다/)).not.toBeInTheDocument()
  })

  it('UUID는 화면에 내보내지 않고 쪽수를 앞세운다', async () => {
    const user = userEvent.setup()
    const materialId = '3f2a1b4c-9d8e-4f70-a1b2-c3d4e5f60718'
    render(<AiEvidenceList sources={[{ type: 'PPTX', materialId, page: 4, excerpt: '본문 발췌' }]} />)

    await user.click(toggle())

    // UUID는 읽는 사람에게 의미가 없다 — 줄여서도 내보내지 않는다.
    expect(screen.queryByText(new RegExp(materialId.slice(0, 8)))).not.toBeInTheDocument()
    // 사람이 먼저 읽어야 하는 건 쪽수이고, 그다음이 발췌문이다.
    expect(screen.getByRole('listitem')).toHaveTextContent(/^4쪽/)
    expect(screen.getByText('본문 발췌')).toBeInTheDocument()
  })
})
