import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { resetMockRecordedLessons } from '@/features/recorded-lesson/mockRecordedLessonService'

vi.mock('@/features/media/HlsMediaPlayer', () => ({
  default: ({
    sourceUrl,
    captionTracks,
  }: {
    sourceUrl: string
    captionTracks: Array<{ src: string; language: string; default: boolean }>
  }) => (
    <div data-testid="student-recorded-player">
      {sourceUrl} · {captionTracks[0]?.src} · {captionTracks[0]?.language} · {String(captionTracks[0]?.default)}
    </div>
  ),
}))

describe('학생 녹화강의 재생 화면', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockRecordedLessons()
    window.history.replaceState({}, '', '/')
  })

  it('게시된 playback의 HLS와 WebVTT 트랙을 같은 플레이어에 전달한다', async () => {
    await mockAuthService.login({ email: 'student@liveclass.ai', password: 'password1' })
    window.history.pushState({}, '', '/student/lessons/lesson-recorded/recorded')
    render(<App />)

    expect(await screen.findByTestId('student-recorded-player')).toHaveTextContent(
      '/api/lessons/lesson-recorded/recorded-playback/manifest',
    )
    expect(screen.getByTestId('student-recorded-player')).toHaveTextContent(
      '/recorded-playback/captions/caption-lesson-recorded.vtt?v=1 · ko · false',
    )
    expect(screen.getByRole('tab', { name: 'AI 질문' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '핵심 용어' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '채팅' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/이 강의에서 궁금한 점/)).toBeInTheDocument()
  })

  it('녹화강의에서 AI 질문 답변과 PPTX 핵심용어를 같은 사이드바에 표시한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student@liveclass.ai', password: 'password1' })
    window.history.pushState({}, '', '/student/lessons/lesson-recorded/recorded')
    render(<App />)

    const question = await screen.findByPlaceholderText(/이 강의에서 궁금한 점/)
    await user.type(question, '현재 구간을 설명해줘')
    await user.click(screen.getByRole('button', { name: '전송' }))

    expect(await screen.findByText('현재 재생 구간의 자막과 강의 자료를 기준으로 설명할게요.'))
      .toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '핵심 용어' }))
    expect(await screen.findAllByText('SecurityContext')).not.toHaveLength(0)
    expect(screen.getByText('현재 요청에서 인증된 사용자와 권한 정보를 보관하는 컨테이너입니다.'))
      .toBeInTheDocument()
  })
})
