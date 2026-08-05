import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import {
  mockLiveSessionService,
  resetMockLiveSessions,
} from '@/features/live-session/mockLiveSessionService'

vi.mock('@/features/live-session/PlaybackPlayer', () => ({
  default: () => <div aria-label="강의 영상" role="region" />,
}))

vi.mock('@/features/live-session/InstructorLiveKitStage', () => ({
  default: () => <div aria-label="송출 도구" role="region" />,
}))

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

const openAiPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('tab', { name: 'AI 질문' }))
}

/**
 * AI 질의응답이 화면에 실제로 붙어 있는지(AI-QUESTION-01).
 *
 * 여기서 확인하는 건 두 가지다 — (1) 라이브 패널이 **세션 스코프**로 질문을 보내고 스트리밍 답변과
 * 근거를 그린다, (2) 다시보기 패널이 **레슨 스코프 + 재생 위치**로 질문한다(ADR-0075).
 */
describe('AI 질의응답 화면 연결', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockLiveSessions()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('라이브 AI 탭은 경로의 sessionId로 질문하고 스트리밍 답변과 근거를 그린다', async () => {
    const askLiveAi = vi.spyOn(mockLiveSessionService, 'askLiveAi')
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    await mockLiveSessionService.startLiveSession('ses-security-live')
    await mockLiveSessionService.getLiveStartStatus('ses-security-live')
    renderAt('/instructor/live-sessions/ses-security-live/classroom')

    await openAiPanel(user)
    await user.type(screen.getByRole('textbox', { name: 'AI에게 할 질문' }), 'SecurityContext가 무엇인가요?{Enter}')

    // 서버는 세션 스코프다 — lessonId를 넘기면 다른 강의의 근거를 열람할 여지가 생긴다(ADR-0047 §1b).
    expect(askLiveAi).toHaveBeenCalledWith(
      'ses-security-live',
      'SecurityContext가 무엇인가요?',
      expect.objectContaining({ onEvent: expect.any(Function), signal: expect.any(AbortSignal) }),
    )

    // 내 질문은 응답을 기다리지 않고 말풍선으로 올라간다.
    expect(screen.getByText('SecurityContext가 무엇인가요?')).toBeInTheDocument()
    // 델타가 누적돼 한 문단으로 자란다.
    expect(await screen.findByText(/요청이 끝나면 컨텍스트가 정리됩니다\./)).toBeInTheDocument()
    // 근거는 접힌 토글로 먼저 요약된다(ADR-0049 §8) — 펼쳐야 목록이 보인다.
    await user.click(await screen.findByRole('button', { name: /^근거 \d+$/ }))
    // 하드코딩 문구가 아니라 실제 sources로 그린 근거 항목이다.
    expect(screen.getByText('12쪽')).toBeVisible()
    // 목이 자막 근거도 함께 주지만 화면에는 나오지 않는다(AiEvidenceList가 감춘다).
    expect(screen.queryByText('12:08–12:41')).not.toBeInTheDocument()
  })

  it('다시보기 AI 탭은 레슨 스코프로 질문하고 재생 위치를 함께 보낸다', async () => {
    const askReplayAi = vi.spyOn(mockLiveSessionService, 'askReplayAi')
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/lessons/les-security/replay')

    await openAiPanel(user)
    await user.type(
      screen.getByRole('textbox', { name: 'AI에게 할 질문' }),
      '여기서 말한 세션이 뭔가요?{Enter}',
    )

    /*
     * 라이브와 스코프가 다르다 — 경로는 레슨이고 세션·커리큘럼은 서버가 재생 자산에서 찾는다.
     * 세 번째 인자는 질문을 누른 순간의 **세션 상대** 재생 위치다(ADR-0075): 이게 없으면 서버가
     * 어느 대목을 물었는지 몰라 근거 자막을 고를 수 없다.
     */
    expect(askReplayAi).toHaveBeenCalledWith(
      'les-security',
      '여기서 말한 세션이 뭔가요?',
      expect.any(Number),
      expect.objectContaining({ onEvent: expect.any(Function), signal: expect.any(AbortSignal) }),
    )

    expect(await screen.findByText(/SecurityContext의 차이입니다\./)).toBeInTheDocument()
  })
})
