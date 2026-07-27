import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import StudentLivePlayer, {
  toMediaTimeSeconds,
  toSessionMs,
} from '@/features/live-session/StudentLivePlayer'

describe('학생 라이브 DVR 플레이어', () => {
  it('HLS 미디어 시각과 세션 시각을 오프셋으로 양방향 변환한다', () => {
    expect(toSessionMs(12.5, 1_250)).toBe(13_750)
    expect(toMediaTimeSeconds(13_750, 1_250)).toBe(12.5)
    expect(toMediaTimeSeconds(500, 1_250)).toBe(0)
  })

  it('실제 재생 주소 조회 실패를 표시하고 재시도할 수 있다', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    render(
      <StudentLivePlayer
        bookmarked={false}
        errorMessage="HLS 영상이 아직 준비되지 않았습니다."
        lessonTitle="세션별 라이브"
        loading={false}
        participantCount={3}
        playback={null}
        playbackKey={0}
        seekRequest={null}
        onBookmark={() => undefined}
        onRetry={onRetry}
        onSessionTimeChange={() => undefined}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('HLS 영상이 아직 준비되지 않았습니다.')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
