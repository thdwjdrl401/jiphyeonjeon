import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CameraOverlayControl from '@/features/live-session/CameraOverlayControl'
import { DEFAULT_CAMERA_OVERLAY, overlayHeight } from '@/features/live-session/cameraOverlay'

function renderControl(overrides = {}, onChange = vi.fn()) {
  const overlay = { ...DEFAULT_CAMERA_OVERLAY, ...overrides }
  render(
    <CameraOverlayControl overlay={overlay} onChange={onChange} {...('disabled' in overrides ? {} : {})}>
      <video aria-label="카메라 미리보기" />
    </CameraOverlayControl>,
  )
  return { onChange, overlay }
}

describe('합성 화면 카메라 편집기', () => {
  it('오버레이 위치와 크기를 비율 그대로 렌더한다', () => {
    renderControl({ x: 0.2, y: 0.3, w: 0.25 })
    const group = screen.getByRole('group', { name: '합성 화면의 카메라 위치' })
    expect(group).toHaveStyle({ left: '20%', top: '30%', width: '25%' })
    expect(group).toHaveStyle({ height: `${overlayHeight(0.25) * 100}%` })
  })

  // 드래그만 지원하면 키보드 사용자가 배치를 바꿀 수 없다. 합성 결과를 정하는 조작이라
  // 마우스 없이도 가능해야 한다.
  it('방향키로 위치를 옮긴다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl({ x: 0.5, y: 0.5 })
    const group = screen.getByRole('group', { name: '합성 화면의 카메라 위치' })
    group.focus()

    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith({ x: 0.48 })
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith({ y: 0.52 })
  })

  it('Shift와 함께 누르면 더 크게 움직인다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl({ x: 0.5 })
    screen.getByRole('group', { name: '합성 화면의 카메라 위치' }).focus()

    await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(onChange).toHaveBeenLastCalledWith({ x: 0.56 })
  })

  it('크기 조절 손잡이를 방향키로 조작한다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl({ w: 0.25 })
    const handle = screen.getByRole('slider', { name: /카메라 크기 조절/ })
    handle.focus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith({ w: 0.27 })
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith({ w: 0.23 })
  })

  it('현재 크기를 보조기술에 백분율로 알린다', () => {
    renderControl({ w: 0.3 })
    const handle = screen.getByRole('slider', { name: '카메라 크기 조절 (현재 화면 폭의 30%)' })
    expect(handle).toHaveAttribute('aria-valuenow', '30')
  })
})
