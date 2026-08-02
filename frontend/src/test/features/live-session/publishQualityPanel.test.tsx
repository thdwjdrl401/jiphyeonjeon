import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PublishQualityPanel from '@/features/live-session/PublishQualityPanel'
import { DEFAULT_PUBLISH_QUALITY } from '@/features/live-session/publishQuality'

describe('송출 화질 패널', () => {
  it('카메라와 화면 공유를 따로 고른다', async () => {
    const onChange = vi.fn()
    render(<PublishQualityPanel applying={false} quality={DEFAULT_PUBLISH_QUALITY} onChange={onChange} />)

    const camera = screen.getByRole('group', { name: '카메라' })
    await userEvent.click(within(camera).getByRole('button', { name: '720p' }))
    expect(onChange).toHaveBeenCalledWith({ camera: 'hd' })

    const screenShare = screen.getByRole('group', { name: '화면 공유' })
    await userEvent.click(within(screenShare).getByRole('button', { name: '720p · 30fps' }))
    expect(onChange).toHaveBeenCalledWith({ screenShare: 'light' })
  })

  it('지금 고른 화질을 눌린 상태로 표시한다', () => {
    render(<PublishQualityPanel applying={false} quality={DEFAULT_PUBLISH_QUALITY} onChange={vi.fn()} />)

    // 기본값은 최고 화질이다 — 강사는 낮추는 방향으로만 조정한다.
    expect(screen.getByRole('button', { name: '1080p' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '720p' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('적용 중에는 잠근다 — 연달아 누르면 트랙 재발행이 겹친다', () => {
    render(<PublishQualityPanel applying quality={DEFAULT_PUBLISH_QUALITY} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '720p' })).toBeDisabled()
    expect(screen.getByText('화질을 적용하는 중입니다…')).toBeInTheDocument()
  })

  it('선택한 화질이 무엇을 잃는지 설명한다', () => {
    render(
      <PublishQualityPanel
        applying={false}
        quality={{ camera: 'sd', screenShare: 'text' }}
        onChange={vi.fn()}
      />,
    )

    // 라벨(540p)만으로는 왜 그걸 고르는지 알 수 없다.
    expect(screen.getByText('연결이 불안정할 때 끊김을 우선합니다.')).toBeInTheDocument()
  })
})
