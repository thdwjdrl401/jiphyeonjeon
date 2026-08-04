import { render, screen } from '@testing-library/react'
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
      '/recorded-playback/captions/caption-lesson-recorded.vtt?v=1 · ko · true',
    )
  })
})
